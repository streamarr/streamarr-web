import Hls, {
  type BufferInfo,
  Events,
  Fragment,
  type HlsConfig,
  type LoaderStats,
  type VideoSelectionOption,
  PlaylistLevelType,
  XhrLoader,
} from 'hls.js'
import { HttpResponse, http } from 'msw'
import { afterEach, assert, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  fakeNetworkLoader,
  forwardBuffer,
  hlsConfigWith,
  segmentCallbacks,
  segmentContext,
  segmentLoadConfiguration,
} from '../test/fakeNetworkLoader'
import { COPY_LADDER, LADDER_URL, type ListedVariant, loadLadder } from '../test/hlsLadder'
import { server } from '../test/server'
import { hlsPlaybackConfig } from './hlsPlaybackConfig'

const SEGMENT_URL = 'https://streamarr.test/api/stream/segment.m4s'

interface ForwardBuffers {
  mainForwardBufferInfo: BufferInfo | null
  audioForwardBufferInfo: BufferInfo | null
}

// What the player gives hls.js for an SDR-only declaration.
const SDR_ONLY: VideoSelectionOption = { preferHDR: false, allowedVideoRanges: ['SDR'] }

// hls.js's time-to-first-byte estimate before it has sampled a segment.
const DEFAULT_TIME_TO_FIRST_BYTE_ESTIMATE_MS = 100

function playerWith(buffers: ForwardBuffers) {
  return () => ({ ...buffers, ttfbEstimate: DEFAULT_TIME_TO_FIRST_BYTE_ESTIMATE_MS })
}

function loadSegment(buffers: ForwardBuffers) {
  const network = fakeNetworkLoader()
  const config = hlsConfigWith(hlsPlaybackConfig(playerWith(buffers), SDR_ONLY), network)
  const SegmentLoader = config.fLoader
  assert(SegmentLoader)
  const loader = new SegmentLoader(config)
  loader.load(segmentContext(), segmentLoadConfiguration(), segmentCallbacks())
  return { loader, network }
}

function firstByteWaitsMs(buffers: ForwardBuffers): number[] {
  return loadSegment(buffers).network.loads.map(
    ({ config }) => config.loadPolicy.maxTimeToFirstByteMs,
  )
}

interface SegmentOutcome {
  outcome: 'loaded' | 'failed' | 'timedOut' | 'aborted'
  afterMs: number
  requestAborted: boolean
}

// The server answers once the test responds, as it answers a starting variant's first segment once
// the producer stores it.
function heldSegmentResponse() {
  let respond: (bytes: number) => void = () => {}
  const response = new Promise<HttpResponse<ArrayBuffer>>((resolve) => {
    respond = (bytes) => resolve(new HttpResponse(new ArrayBuffer(bytes)))
  })
  server.use(http.get(SEGMENT_URL, () => response))
  onTestFinished(() => respond(0))
  return { respond }
}

// The forward buffer of a video that plays at normal speed through `bufferedSeconds` of media.
function playingVideo(bufferedSeconds: number) {
  let bufferedUntilMs = performance.now() + bufferedSeconds * 1000
  return {
    buffers: {
      get mainForwardBufferInfo() {
        return forwardBuffer(Math.max(0, bufferedUntilMs - performance.now()) / 1000)
      },
      audioForwardBufferInfo: null,
    },
    seekForward(seconds: number) {
      bufferedUntilMs -= seconds * 1000
    },
  }
}

// Loads a media segment as hls.js's fragment loader does, over hls.js's own network loader.
function loadSegmentOverNetwork(buffers: ForwardBuffers) {
  const config = hlsConfigWith(hlsPlaybackConfig(playerWith(buffers), SDR_ONLY), {
    Loader: XhrLoader,
  })
  const SegmentLoader = config.fLoader
  assert(SegmentLoader)
  const loader = new SegmentLoader(config)
  const outcomes: SegmentOutcome[] = []
  const startedAt = performance.now()
  const settle = (outcome: SegmentOutcome['outcome'], stats: LoaderStats) =>
    outcomes.push({
      outcome,
      afterMs: performance.now() - startedAt,
      requestAborted: stats.aborted,
    })
  loader.load({ ...segmentContext(), url: SEGMENT_URL }, segmentLoadConfiguration(), {
    onSuccess: (_response, stats) => settle('loaded', stats),
    onError: (_response, _context, _details, stats) => settle('failed', stats),
    onTimeout: (stats) => settle('timedOut', stats),
    onAbort: (stats) => settle('aborted', stats),
  })
  return { loader, outcomes }
}

// Loads a 3 MB media segment as hls.js's fragment loader does, and hands its load timing to hls.js's
// bandwidth estimator as hls.js does once the segment has loaded and once it is buffered.
async function estimatesAfterSegment({
  config,
  firstByteAfterMs,
}: {
  config: (player: () => Hls) => Partial<HlsConfig>
  firstByteAfterMs: number
}) {
  const segment = heldSegmentResponse()
  const hls: Hls = new Hls(config(() => hls))
  const frag = new Fragment(PlaylistLevelType.MAIN, SEGMENT_URL)
  frag.sn = 1
  frag.level = 0
  frag.duration = 6
  // hls.js ends the sample of a segment of 100 kb/s or more where its parsing ends.
  frag.bitrate = 4_000_000
  const SegmentLoader = hls.config.fLoader ?? hls.config.loader
  const loader = new SegmentLoader(hls.config)
  frag.stats = loader.stats
  const loaded = new Promise<LoaderStats>((resolve, reject) => {
    loader.load({ ...segmentContext(), url: SEGMENT_URL }, segmentLoadConfiguration(), {
      onSuccess: (_response, stats) => resolve(stats),
      onError: () => reject(new Error('The segment failed')),
      onTimeout: () => reject(new Error('The segment timed out')),
    })
  })
  await vi.advanceTimersByTimeAsync(firstByteAfterMs)
  segment.respond(3_000_000)
  const stats = await loaded
  hls.trigger(Events.FRAG_LOADED, {
    frag,
    part: null,
    payload: new ArrayBuffer(0),
    networkDetails: null,
  })
  // The test server sends the whole body at once, so the transfer and parsing take 300 ms together.
  stats.parsing.start = stats.loading.end
  stats.parsing.end = stats.loading.end + 300
  hls.trigger(Events.FRAG_BUFFERED, { frag, part: null, stats, id: PlaylistLevelType.MAIN })
  const estimates = { bandwidthBps: hls.bandwidthEstimate, timeToFirstByteMs: hls.ttfbEstimate }
  hls.destroy()
  return estimates
}

// What the player gives hls.js, with 30 s buffered: hls.js has no media to buffer in a test.
function playbackConfigWith30SecondsBuffered(player: () => Hls): Partial<HlsConfig> {
  return hlsPlaybackConfig(
    () => ({
      mainForwardBufferInfo: forwardBuffer(30),
      audioForwardBufferInfo: null,
      ttfbEstimate: player().ttfbEstimate,
    }),
    SDR_ONLY,
  )
}

// The media playlist that hls.js, with the player's settings, asks for first.
async function firstMediaPlaylistOf(
  variants: readonly ListedVariant[],
  videoPreference: VideoSelectionOption,
): Promise<string | undefined> {
  const { mediaPlaylists } = await loadLadder(variants, (player) =>
    hlsPlaybackConfig(player, videoPreference),
  )
  return mediaPlaylists[0]
}

// hls.js's bandwidth estimate once it has parsed a multivariant playlist that lists `variants`, and
// again once it has measured one 1.125 MB media segment of the first variant that it loads. The
// segment's first byte arrives after 100 ms and its last after 1 s, so hls.js, which leaves out the
// time to the first byte, measures 10 Mb/s.
async function estimatesBeforeAndAfterASegment(
  variants: readonly ListedVariant[],
  config: (player: () => Hls) => Partial<HlsConfig>,
) {
  const { hls } = await loadLadder(variants, config)
  const beforeSegmentBps = hls.bandwidthEstimate
  const frag = new Fragment(PlaylistLevelType.MAIN, LADDER_URL)
  frag.sn = 0
  frag.level = hls.loadLevel
  frag.duration = 6
  const { stats } = frag
  stats.loaded = 1_125_000
  stats.loading = { start: 0, first: 100, end: 1_000 }
  hls.trigger(Events.FRAG_LOADED, {
    frag,
    part: null,
    payload: new ArrayBuffer(0),
    networkDetails: null,
  })
  hls.trigger(Events.FRAG_BUFFERED, { frag, part: null, stats, id: PlaylistLevelType.MAIN })
  return { beforeSegmentBps, afterSegmentBps: hls.bandwidthEstimate }
}

describe('hlsPlaybackConfig', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldWaitForAStartingVariantsFirstSegmentWhenTheForwardBufferOutlastsTheWait', () => {
    expect(
      firstByteWaitsMs({ mainForwardBufferInfo: forwardBuffer(30), audioForwardBufferInfo: null }),
    ).toEqual([20_000])
  })

  it('shouldKeepTheDefaultWaitInReserveWhenTheForwardBufferIsShorterThanBoth', () => {
    expect(
      firstByteWaitsMs({ mainForwardBufferInfo: forwardBuffer(25), audioForwardBufferInfo: null }),
    ).toEqual([15_000])
  })

  it.each([
    {
      buffered: 'short',
      buffers: { mainForwardBufferInfo: forwardBuffer(12), audioForwardBufferInfo: null },
    },
    {
      buffered: 'empty',
      buffers: { mainForwardBufferInfo: forwardBuffer(0), audioForwardBufferInfo: null },
    },
    { buffered: 'unknown', buffers: { mainForwardBufferInfo: null, audioForwardBufferInfo: null } },
  ])('shouldWaitTheDefaultTimeWhenTheForwardBufferIs$buffered', ({ buffers }) => {
    expect(firstByteWaitsMs(buffers)).toEqual([10_000])
  })

  it('shouldWaitOnlyAsLongAsTheAudioBufferAllowsWhenAudioRunsOutFirst', () => {
    expect(
      firstByteWaitsMs({
        mainForwardBufferInfo: forwardBuffer(30),
        audioForwardBufferInfo: forwardBuffer(22),
      }),
    ).toEqual([12_000])
  })

  it('shouldKeepTheRestOfTheSegmentPolicyWhenItExtendsTheWait', () => {
    const { network } = loadSegment({
      mainForwardBufferInfo: forwardBuffer(30),
      audioForwardBufferInfo: null,
    })

    expect(network.loads.map(({ context, config }) => ({ context, config }))).toEqual([
      {
        context: segmentContext(),
        config: {
          ...segmentLoadConfiguration(),
          loadPolicy: { ...segmentLoadConfiguration().loadPolicy, maxTimeToFirstByteMs: 20_000 },
        },
      },
    ])
  })

  it('shouldReadTheForwardBufferWhenEachSegmentStartsLoading', () => {
    const buffers: ForwardBuffers = { mainForwardBufferInfo: null, audioForwardBufferInfo: null }
    const network = fakeNetworkLoader()
    const config = hlsConfigWith(hlsPlaybackConfig(playerWith(buffers), SDR_ONLY), network)
    const SegmentLoader = config.fLoader
    assert(SegmentLoader)
    const loader = new SegmentLoader(config)

    buffers.mainForwardBufferInfo = forwardBuffer(30)
    loader.load(segmentContext(), segmentLoadConfiguration(), segmentCallbacks())

    expect(network.loads.map(({ config }) => config.loadPolicy.maxTimeToFirstByteMs)).toEqual([
      20_000,
    ])
  })

  it('shouldReportTheNetworkLoadersProgressWhenHlsReadsTheSegmentLoader', () => {
    const { loader, network } = loadSegment({
      mainForwardBufferInfo: forwardBuffer(30),
      audioForwardBufferInfo: null,
    })
    const [networkLoader] = network.loaders
    assert(networkLoader)

    expect(loader.stats).toBe(networkLoader.stats)
    expect(loader.context).toBe(networkLoader.context)
  })

  it('shouldStopTheNetworkRequestWhenHlsAbortsOrDestroysTheSegmentLoader', () => {
    const { loader, network } = loadSegment({
      mainForwardBufferInfo: forwardBuffer(30),
      audioForwardBufferInfo: null,
    })
    const [networkLoader] = network.loaders
    assert(networkLoader)

    loader.abort()
    loader.destroy()

    expect(networkLoader.stats.aborted).toBe(true)
    expect(networkLoader.destroyed).toBe(true)
  })

  it('shouldLetHlsChooseAFailedVariantAgainWhenAMinuteHasPassed', () => {
    const config = hlsPlaybackConfig(
      playerWith({ mainForwardBufferInfo: null, audioForwardBufferInfo: null }),
      SDR_ONLY,
    )

    expect(config.errorPenaltyExpireMs).toBe(60_000)
  })

  it('shouldTimeOutWhenTheBufferRunsOutAfterASeekForwardInsideIt', async () => {
    heldSegmentResponse()
    const video = playingVideo(30)
    const { outcomes } = loadSegmentOverNetwork(video.buffers)

    await vi.advanceTimersByTimeAsync(1_000)
    video.seekForward(20)
    await vi.advanceTimersByTimeAsync(9_000)

    expect(outcomes).toEqual([{ outcome: 'timedOut', afterMs: 10_000, requestAborted: true }])
  })

  it('shouldKeepTheDefaultWaitInReserveWhenASeekForwardShortensTheBuffer', async () => {
    heldSegmentResponse()
    const video = playingVideo(30)
    const { outcomes } = loadSegmentOverNetwork(video.buffers)

    await vi.advanceTimersByTimeAsync(1_000)
    video.seekForward(4)
    await vi.advanceTimersByTimeAsync(14_999)
    const beforeTheBufferReachesTheDefaultWait = [...outcomes]
    await vi.advanceTimersByTimeAsync(1)

    expect(beforeTheBufferReachesTheDefaultWait).toEqual([])
    expect(outcomes).toEqual([{ outcome: 'timedOut', afterMs: 16_000, requestAborted: true }])
  })

  it('shouldWaitTheExtendedTimeWhenPlaybackConsumesTheBuffer', async () => {
    heldSegmentResponse()
    const { outcomes } = loadSegmentOverNetwork(playingVideo(30).buffers)

    await vi.advanceTimersByTimeAsync(20_000)

    expect(outcomes).toEqual([{ outcome: 'timedOut', afterMs: 20_000, requestAborted: true }])
  })

  it('shouldKeepLoadingTheSegmentWhenTheBufferRunsLowAfterItsFirstByte', async () => {
    const segment = heldSegmentResponse()
    const video = playingVideo(30)
    const { outcomes } = loadSegmentOverNetwork(video.buffers)

    await vi.advanceTimersByTimeAsync(15_000)
    segment.respond(1_000)
    await vi.advanceTimersByTimeAsync(0)
    video.seekForward(15)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(outcomes).toEqual([{ outcome: 'loaded', afterMs: 15_000, requestAborted: false }])
  })

  it('shouldReportAnAbortWhenHlsAbortsTheSegmentLoaderWhileItWaits', async () => {
    heldSegmentResponse()
    const video = playingVideo(30)
    const { loader, outcomes } = loadSegmentOverNetwork(video.buffers)

    await vi.advanceTimersByTimeAsync(5_000)
    loader.abort()
    video.seekForward(25)
    await vi.advanceTimersByTimeAsync(20_000)

    expect(outcomes).toEqual([{ outcome: 'aborted', afterMs: 5_000, requestAborted: true }])
  })

  it('shouldLeaveAStartingVariantsWaitOutOfTheBandwidthEstimateWhenItsSegmentArrives', async () => {
    const afterStartingVariantWait = await estimatesAfterSegment({
      config: playbackConfigWith30SecondsBuffered,
      firstByteAfterMs: 15_000,
    })
    const afterPromptFirstByte = await estimatesAfterSegment({
      config: playbackConfigWith30SecondsBuffered,
      firstByteAfterMs: 100,
    })

    expect(afterStartingVariantWait).toEqual(afterPromptFirstByte)
  })

  it('shouldEstimateBandwidthAsHlsDoesWhenTheFirstByteArrivesWithinTheDefaultWait', async () => {
    const withPlaybackConfig = await estimatesAfterSegment({
      config: playbackConfigWith30SecondsBuffered,
      firstByteAfterMs: 5_000,
    })
    const withHlsDefaults = await estimatesAfterSegment({
      config: () => ({}),
      firstByteAfterMs: 5_000,
    })

    expect(withPlaybackConfig).toEqual(withHlsDefaults)
  })

  it('shouldStartOnTheFirstListedVariantWhenItPeaksAbove5MbpsOverTheVariantsBeneathIt', async () => {
    expect(await firstMediaPlaylistOf(COPY_LADDER, SDR_ONLY)).toBe('stream.m3u8')
  })

  it('shouldStartOnTheTopVariantInTheAllowedRangeWhenTheFirstListedVariantIsOutsideIt', async () => {
    const pqCopyAboveSdrEncodes: ListedVariant[] = [
      { ...COPY_LADDER[0], range: 'PQ' },
      { playlist: '1080p/stream.m3u8', bandwidth: 6_153_600, height: 1080, range: 'SDR' },
      ...COPY_LADDER.slice(1),
    ]

    expect(await firstMediaPlaylistOf(pqCopyAboveSdrEncodes, SDR_ONLY)).toBe('1080p/stream.m3u8')
  })

  it('shouldEstimateFromTheMeasuredSegmentWhenOneLoadsAfterStartingFromTheFirstListedVariant', async () => {
    const withPlaybackConfig = await estimatesBeforeAndAfterASegment(COPY_LADDER, (player) =>
      hlsPlaybackConfig(player, SDR_ONLY),
    )
    const withHlsDefaults = await estimatesBeforeAndAfterASegment(COPY_LADDER, () => ({}))

    expect(withPlaybackConfig.beforeSegmentBps).toBe(20_000_000)
    expect(withHlsDefaults.beforeSegmentBps).toBe(5_000_000)
    expect(withPlaybackConfig.afterSegmentBps).toBeCloseTo(10_000_000, 0)
    expect(withPlaybackConfig.afterSegmentBps).toBe(withHlsDefaults.afterSegmentBps)
  })
})
