import Hls, { Events, Fragment, PlaylistLevelType, type VideoSelectionOption } from 'hls.js'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COPY_LADDER, LADDER_URL, type ListedVariant, loadLadder } from '../test/hlsLadder'
import { server } from '../test/server'
import { stepDownFromASlowFirstSegment } from './firstSegmentStepDown'
import { hlsPlaybackConfig } from './hlsPlaybackConfig'

// What the player passes: a quarter of its 30 s startup limit.
const SILENCE_LIMIT_MS = 7_500
// The 20 Mb/s copy's six-second first segment.
const COPY_SEGMENT_BYTES = 15_000_000
// How often the test link delivers bytes.
const DELIVERY_MS = 50

const SDR_ONLY: VideoSelectionOption = { preferHDR: false, allowedVideoRanges: ['SDR'] }
const PREFERRING_PQ: VideoSelectionOption = { preferHDR: true, allowedVideoRanges: ['SDR', 'PQ'] }

const PQ_COPY_ABOVE_SDR_ENCODES: readonly ListedVariant[] = [
  { ...COPY_LADDER[0], range: 'PQ' },
  ...COPY_LADDER.slice(1),
]
const HEVC_COPY_ABOVE_H264_ENCODES: readonly ListedVariant[] = [
  { ...COPY_LADDER[0], codecs: 'hvc1.1.6.L123.B0,mp4a.40.2' },
  ...COPY_LADDER.slice(1),
]

interface Start {
  ladder?: readonly ListedVariant[]
  videoPreference?: VideoSelectionOption
  /** The element's readyState when the segment starts loading. */
  readyState?: number
  /** How much of the startup limit is left when the segment starts loading. */
  startupLeftMs?: number
}

// hls.js with the player's settings and the step down, on a ladder whose first-listed variant
// hls.js starts on.
async function startPlayer({
  ladder = COPY_LADDER,
  videoPreference = SDR_ONLY,
  readyState = HTMLMediaElement.HAVE_NOTHING,
  startupLeftMs = 28_000,
}: Start = {}) {
  const { hls, mediaPlaylists } = await loadLadder(ladder, (player) =>
    hlsPlaybackConfig(player, videoPreference),
  )
  const startupEndsAt = performance.now() + startupLeftMs
  stepDownFromASlowFirstSegment({
    hls,
    video: { readyState },
    startupRemainingMs: () => startupEndsAt - performance.now(),
    silenceLimitMs: SILENCE_LIMIT_MS,
  })
  return { hls, mediaPlaylists }
}

// The first media segment of the variant that hls.js loads, as hls.js reports it once its request
// has gone out. The response names its length unless `total` says it names none.
function loadFirstSegment(hls: Hls, { total = COPY_SEGMENT_BYTES } = {}): Fragment {
  const frag = new Fragment(PlaylistLevelType.MAIN, `${LADDER_URL}segment0.m4s`)
  frag.sn = 0
  frag.level = hls.loadLevel
  frag.duration = 6
  frag.stats.loading.start = performance.now()
  frag.stats.total = total
  hls.trigger(Events.FRAG_LOADING, { frag, targetBufferTime: 0 })
  return frag
}

// Delivers the segment's bytes as a link of `bitsPerSecond` does, for `forMs`, as hls.js's loader
// reports them.
async function deliver(
  frag: Fragment,
  { bitsPerSecond, forMs }: { bitsPerSecond: number; forMs: number },
) {
  const { stats } = frag
  for (let delivered = 0; delivered < forMs; delivered += DELIVERY_MS) {
    await vi.advanceTimersByTimeAsync(DELIVERY_MS)
    stats.loading.first ||= performance.now()
    stats.loaded += (bitsPerSecond / 8) * (DELIVERY_MS / 1000)
  }
}

function finish(frag: Fragment) {
  frag.stats.loaded = COPY_SEGMENT_BYTES
  frag.stats.loading.end = performance.now()
}

// The height of the variant whose segments hls.js loads.
function loadingHeight(hls: Hls): number | undefined {
  return hls.levels[hls.loadLevel]?.height
}

describe('stepDownFromASlowFirstSegment', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldStartOnTheLowestVariantWhenTheFirstSegmentsBytesShowItCannotArriveWithinTheStartupLimit', async () => {
    const { hls, mediaPlaylists } = await startPlayer()
    const segment = loadFirstSegment(hls)

    // At 2 Mb/s the copy's segment needs 60 s.
    await deliver(segment, { bitsPerSecond: 2_000_000, forMs: 3_100 })

    expect(loadingHeight(hls)).toBe(360)
    await vi.waitFor(() => expect(mediaPlaylists).toEqual(['stream.m3u8', '360p/stream.m3u8']))
  })

  it('shouldKeepTheFirstListedVariantWhenItsFirstSegmentArrivesWithinTheStartupLimit', async () => {
    const { hls, mediaPlaylists } = await startPlayer()
    const segment = loadFirstSegment(hls)

    // At 10 Mb/s the copy's segment needs 12 s.
    await deliver(segment, { bitsPerSecond: 10_000_000, forMs: 12_000 })
    finish(segment)
    await vi.advanceTimersByTimeAsync(2 * SILENCE_LIMIT_MS)

    expect(loadingHeight(hls)).toBe(1080)
    expect(mediaPlaylists).toEqual(['stream.m3u8'])
  })

  it('shouldStartOnTheLowestVariantWhenLessOfTheStartupLimitIsLeftThanTheFirstSegmentNeeds', async () => {
    const { hls } = await startPlayer({ startupLeftMs: 10_000 })
    const segment = loadFirstSegment(hls)

    await deliver(segment, { bitsPerSecond: 10_000_000, forMs: 3_100 })

    expect(loadingHeight(hls)).toBe(360)
  })

  it('shouldStartOnTheLowestVariantWhenNoByteOfTheFirstSegmentArrivesForTheSilenceLimit', async () => {
    const { hls } = await startPlayer()
    loadFirstSegment(hls)

    await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS - 100)
    const beforeTheLimit = loadingHeight(hls)
    await vi.advanceTimersByTimeAsync(200)

    expect(beforeTheLimit).toBe(1080)
    expect(loadingHeight(hls)).toBe(360)
  })

  it('shouldStartOnTheLowestVariantWhenTheFirstSegmentsBytesStopForTheSilenceLimit', async () => {
    const { hls } = await startPlayer()
    const segment = loadFirstSegment(hls)

    // 13.75 of the segment's 15 MB arrive, and then nothing.
    await deliver(segment, { bitsPerSecond: 10_000_000, forMs: 11_000 })
    await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS - 100)
    const beforeTheLimit = loadingHeight(hls)
    await vi.advanceTimersByTimeAsync(200)

    expect(beforeTheLimit).toBe(1080)
    expect(loadingHeight(hls)).toBe(360)
  })

  // The server holds a starting variant's first segment until it has stored it, so the segment's
  // first byte can come seconds after its request.
  it.each([
    { firstByteAfter: 'NoWait', waitMs: 0 },
    { firstByteAfter: 'TheServersHold', waitMs: 4_000 },
  ])(
    'shouldJudgeTheFirstSegmentsRateOnlyOnceHalfItsDurationHasPassedSinceItsFirstByteWhenThatComesAfter$firstByteAfter',
    async ({ waitMs }) => {
      const { hls } = await startPlayer()
      const segment = loadFirstSegment(hls)

      await vi.advanceTimersByTimeAsync(waitMs)
      // Its first second alone would take 240 s for the whole segment; the rest arrives in 3 s more.
      await deliver(segment, { bitsPerSecond: 500_000, forMs: 1_000 })
      await deliver(segment, { bitsPerSecond: 40_000_000, forMs: 3_000 })
      finish(segment)

      expect(loadingHeight(hls)).toBe(1080)
    },
  )

  it('shouldProjectFromTheVariantsBitrateWhenTheResponseNamesNoLength', async () => {
    const { hls } = await startPlayer()
    const segment = loadFirstSegment(hls, { total: 0 })

    await deliver(segment, { bitsPerSecond: 2_000_000, forMs: 3_100 })

    expect(loadingHeight(hls)).toBe(360)
  })

  // When the lowest variant's playlist fails, hls.js goes back to the copy and keeps that variant
  // out of its choices. The copy's first segment keeps loading: hls.js asks for it no second time.
  it('shouldStartOnTheLowestVariantLeftWhenTheLowestVariantFailsWhileTheFirstSegmentKeepsLoading', async () => {
    const { hls, mediaPlaylists } = await startPlayer()
    server.use(
      http.get(`${LADDER_URL}360p/stream.m3u8`, () => {
        mediaPlaylists.push('360p/stream.m3u8')
        return new HttpResponse(null, { status: 404 })
      }),
    )
    const segment = loadFirstSegment(hls)

    // The step down comes at about 3 s; the bytes go on arriving for as long again.
    await deliver(segment, { bitsPerSecond: 2_000_000, forMs: 6_000 })

    expect(loadingHeight(hls)).toBe(720)
    expect(mediaPlaylists).toEqual(['stream.m3u8', '360p/stream.m3u8', '720p/stream.m3u8'])
  })

  // As on a stream with one variant, the first segment keeps loading.
  it('shouldKeepLoadingTheFirstSegmentWhenEveryLowerVariantFails', async () => {
    const { hls, mediaPlaylists } = await startPlayer()
    server.use(
      http.get(`${LADDER_URL}:variant/stream.m3u8`, ({ params }) => {
        mediaPlaylists.push(`${String(params.variant)}/stream.m3u8`)
        return new HttpResponse(null, { status: 404 })
      }),
    )
    const segment = loadFirstSegment(hls)

    await deliver(segment, { bitsPerSecond: 2_000_000, forMs: 6_000 })

    expect(loadingHeight(hls)).toBe(1080)
    expect(mediaPlaylists).toEqual(['stream.m3u8', '360p/stream.m3u8', '720p/stream.m3u8'])
  })

  it.each([
    { sharing: 'VideoRange', ladder: PQ_COPY_ABOVE_SDR_ENCODES, videoPreference: PREFERRING_PQ },
    { sharing: 'Codecs', ladder: HEVC_COPY_ABOVE_H264_ENCODES, videoPreference: SDR_ONLY },
  ])(
    'shouldKeepLoadingTheFirstSegmentWhenNoLowerVariantSharesIts$sharing',
    async ({ ladder, videoPreference }) => {
      const { hls, mediaPlaylists } = await startPlayer({ ladder, videoPreference })
      loadFirstSegment(hls)

      await vi.advanceTimersByTimeAsync(2 * SILENCE_LIMIT_MS)

      expect(mediaPlaylists).toEqual(['stream.m3u8'])
      expect(loadingHeight(hls)).toBe(1080)
    },
  )

  it('shouldLeaveASegmentAloneWhenTheElementHasDataAlready', async () => {
    const { hls } = await startPlayer({ readyState: HTMLMediaElement.HAVE_METADATA })
    loadFirstSegment(hls)

    await vi.advanceTimersByTimeAsync(2 * SILENCE_LIMIT_MS)

    expect(loadingHeight(hls)).toBe(1080)
  })

  it('shouldLeaveTheFirstSegmentAloneOnceHlsAbortsItsLoad', async () => {
    const { hls } = await startPlayer()
    const segment = loadFirstSegment(hls)

    segment.stats.aborted = true
    await vi.advanceTimersByTimeAsync(2 * SILENCE_LIMIT_MS)

    expect(loadingHeight(hls)).toBe(1080)
  })

  // As after a seek before the element has data: hls.js aborts the load and loads another segment.
  it('shouldWatchTheSegmentThatHlsLoadsInPlaceOfAnAbortedOne', async () => {
    const { hls } = await startPlayer()
    const aborted = loadFirstSegment(hls)
    await vi.advanceTimersByTimeAsync(1_000)

    aborted.stats.aborted = true
    loadFirstSegment(hls)
    await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS + 100)

    expect(loadingHeight(hls)).toBe(360)
  })

  // hls.js reports an initialization segment's load before the load starts.
  it('shouldLeaveAnInitializationSegmentAlone', async () => {
    const { hls } = await startPlayer()
    await vi.advanceTimersByTimeAsync(2 * SILENCE_LIMIT_MS)
    const initSegment = new Fragment(PlaylistLevelType.MAIN, `${LADDER_URL}init.mp4`)
    initSegment.sn = 'initSegment'
    initSegment.level = hls.loadLevel

    hls.trigger(Events.FRAG_LOADING, { frag: initSegment, targetBufferTime: 0 })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(loadingHeight(hls)).toBe(1080)
  })

  // An audio rendition's segment carries the audio track's index where a media segment carries
  // its variant's.
  it('shouldKeepWatchingTheFirstSegmentWhenAnAudioSegmentStartsLoading', async () => {
    const { hls } = await startPlayer()
    loadFirstSegment(hls)
    const audioSegment = new Fragment(PlaylistLevelType.AUDIO, `${LADDER_URL}audio/segment0.m4s`)
    audioSegment.sn = 0
    audioSegment.level = 0

    hls.trigger(Events.FRAG_LOADING, { frag: audioSegment, targetBufferTime: 0 })
    await vi.advanceTimersByTimeAsync(SILENCE_LIMIT_MS + 100)

    expect(loadingHeight(hls)).toBe(360)
  })

  it('shouldStopWatchingWhenHlsIsDestroyed', async () => {
    const { hls } = await startPlayer()
    loadFirstSegment(hls)

    hls.destroy()
    await vi.advanceTimersByTimeAsync(2 * SILENCE_LIMIT_MS)

    expect(vi.getTimerCount()).toBe(0)
  })
})
