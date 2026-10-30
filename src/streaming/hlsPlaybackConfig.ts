import type Hls from 'hls.js'
import type {
  FragmentLoaderConstructor,
  FragmentLoaderContext,
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderStats,
} from 'hls.js'

// The server answers a request for a starting variant's first segment once that whole segment is
// stored, so its first byte arrives only when the variant has started. The server replaces a
// starting variant that stores nothing within its producer stall threshold plus one target
// segment duration (16 s by default); the rest covers the request reaching the server before it
// starts counting.
const STARTING_VARIANT_WAIT_MS = 20_000
// hls.js otherwise keeps a variant that failed out of its choices for the rest of the session. The
// expiry covers a variant whose failure made hls.js switch variants; a timed-out request that
// hls.js retries leaves only a fragment error, which no expiry lifts.
const FAILED_VARIANT_PENALTY_MS = 60_000
// hls.js checks a loading segment's progress against the forward buffer as often.
const FORWARD_BUFFER_CHECK_MS = 100

type ForwardBuffers = Pick<Hls, 'mainForwardBufferInfo' | 'audioForwardBufferInfo'>
type LoadingPlayer = ForwardBuffers & Pick<Hls, 'ttfbEstimate'>

/**
 * The hls.js settings the player plays with. `player` returns the hls.js instance they are given
 * to; it is read only while that instance loads segments.
 */
export function hlsPlaybackConfig(player: () => LoadingPlayer): Partial<HlsConfig> {
  return {
    fLoader: segmentLoaderWithinForwardBuffer(player),
    errorPenaltyExpireMs: FAILED_VARIANT_PENALTY_MS,
  }
}

function segmentLoaderWithinForwardBuffer(player: () => LoadingPlayer): FragmentLoaderConstructor {
  return class SegmentLoader implements Loader<FragmentLoaderContext> {
    private readonly network: Loader<FragmentLoaderContext>
    private forwardBufferCheck: ReturnType<typeof setInterval> | undefined
    private outlivedForwardBuffer = false

    constructor(config: HlsConfig) {
      // hls.js casts its network loader the same way: one loader class serves every request type.
      this.network = new config.loader(config) as Loader<FragmentLoaderContext>
    }

    get context() {
      return this.network.context
    }

    get stats() {
      return this.network.stats
    }

    load(
      context: FragmentLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<FragmentLoaderContext>,
    ) {
      const { loadPolicy } = config
      const defaultWaitMs = loadPolicy.maxTimeToFirstByteMs
      const maxTimeToFirstByteMs = firstByteWaitMs(defaultWaitMs, forwardBufferMs(player()))
      this.network.load(
        context,
        { ...config, loadPolicy: { ...loadPolicy, maxTimeToFirstByteMs } },
        this.reportingTo(callbacks, defaultWaitMs),
      )
      if (maxTimeToFirstByteMs > defaultWaitMs) {
        this.forwardBufferCheck = setInterval(
          () => this.timeOutPastForwardBuffer(defaultWaitMs),
          FORWARD_BUFFER_CHECK_MS,
        )
      }
    }

    abort() {
      this.stopForwardBufferCheck()
      this.network.abort()
    }

    destroy() {
      this.stopForwardBufferCheck()
      this.network.destroy()
    }

    // hls.js keeps a request alive across a seek inside the buffer, and a seek, a buffer flush or
    // faster playback leaves less buffer than the wait was sized for, so the wait shrinks with it.
    private timeOutPastForwardBuffer(defaultWaitMs: number) {
      const { loading } = this.network.stats
      if (loading.first) {
        this.stopForwardBufferCheck()
        return
      }
      const waitedMs = performance.now() - loading.start
      const untilBufferRunsOutMs = waitedMs + forwardBufferMs(player())
      if (waitedMs < firstByteWaitMs(defaultWaitMs, untilBufferRunsOutMs)) {
        return
      }
      this.outlivedForwardBuffer = true
      this.abort()
    }

    // The abort this loader makes when the buffer runs short reaches hls.js as the timeout it gets
    // when a first byte is late, so hls.js recovers from both the same way.
    private reportingTo(
      callbacks: LoaderCallbacks<FragmentLoaderContext>,
      defaultWaitMs: number,
    ): LoaderCallbacks<FragmentLoaderContext> {
      return {
        ...callbacks,
        onSuccess: (response, stats, context, networkDetails) => {
          this.stopForwardBufferCheck()
          reportStartingVariantWaitAsEstimate(stats, defaultWaitMs, player().ttfbEstimate)
          callbacks.onSuccess(response, stats, context, networkDetails)
        },
        onError: (...args) => {
          this.stopForwardBufferCheck()
          callbacks.onError(...args)
        },
        onTimeout: (...args) => {
          this.stopForwardBufferCheck()
          callbacks.onTimeout(...args)
        },
        onAbort: (...args) => {
          if (this.outlivedForwardBuffer) {
            callbacks.onTimeout(...args)
            return
          }
          callbacks.onAbort?.(...args)
        },
      }
    }

    private stopForwardBufferCheck() {
      clearInterval(this.forwardBufferCheck)
    }
  }
}

// A request that gives up still leaves the default wait in the buffer, so the request hls.js makes
// next, usually at a lower variant, has as long as any request had before playback would stall.
function firstByteWaitMs(defaultWaitMs: number, untilBufferRunsOutMs: number): number {
  return Math.max(
    defaultWaitMs,
    Math.min(STARTING_VARIANT_WAIT_MS, untilBufferRunsOutMs - defaultWaitMs),
  )
}

// hls.js samples a segment's bandwidth over its whole load less at most its time-to-first-byte
// estimate, so a first byte later than the default wait, which only a starting variant's wait lets
// arrive, would count the producer's startup as transfer time. Reporting that wait as the estimate
// leaves the sample to the transfer alone, and a sample of the estimate's own value leaves it as is.
function reportStartingVariantWaitAsEstimate(
  stats: LoaderStats,
  defaultWaitMs: number,
  timeToFirstByteEstimateMs: number,
) {
  const { loading } = stats
  if (loading.first - loading.start <= defaultWaitMs) {
    return
  }
  loading.start = loading.first - timeToFirstByteEstimateMs
}

function forwardBufferMs({
  mainForwardBufferInfo,
  audioForwardBufferInfo,
}: ForwardBuffers): number {
  const main = mainForwardBufferInfo?.len ?? 0
  const audio = audioForwardBufferInfo?.len ?? main
  return Math.min(main, audio) * 1000
}
