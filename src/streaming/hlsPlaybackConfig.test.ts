import { type BufferInfo, type LoaderStats, XhrLoader } from 'hls.js'
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
import { server } from '../test/server'
import { hlsPlaybackConfig } from './hlsPlaybackConfig'

const SEGMENT_URL = 'https://streamarr.test/api/stream/segment.m4s'

interface ForwardBuffers {
  mainForwardBufferInfo: BufferInfo | null
  audioForwardBufferInfo: BufferInfo | null
}

function loadSegment(buffers: ForwardBuffers) {
  const network = fakeNetworkLoader()
  const config = hlsConfigWith(
    hlsPlaybackConfig(() => buffers),
    network,
  )
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
  const config = hlsConfigWith(
    hlsPlaybackConfig(() => buffers),
    { Loader: XhrLoader },
  )
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
    const config = hlsConfigWith(
      hlsPlaybackConfig(() => buffers),
      network,
    )
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
    const config = hlsPlaybackConfig(() => ({
      mainForwardBufferInfo: null,
      audioForwardBufferInfo: null,
    }))

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
})
