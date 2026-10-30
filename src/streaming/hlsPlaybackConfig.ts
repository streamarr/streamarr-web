import type Hls from 'hls.js'
import type {
  FragmentLoaderConstructor,
  FragmentLoaderContext,
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
} from 'hls.js'

// The server answers a request for a starting variant's first segment once that whole segment is
// stored, so its first byte arrives only when the variant has started. The server replaces a
// starting variant that stores nothing within its producer stall threshold plus one target
// segment duration (16 s by default); the rest covers the request reaching the server before it
// starts counting.
const STARTING_VARIANT_WAIT_MS = 20_000

type ForwardBuffers = Pick<Hls, 'mainForwardBufferInfo' | 'audioForwardBufferInfo'>

/**
 * The hls.js settings the player plays with. `player` returns the hls.js instance they are given
 * to; it is read only while that instance loads segments.
 */
export function hlsPlaybackConfig(player: () => ForwardBuffers): Partial<HlsConfig> {
  return { fLoader: segmentLoaderWithinForwardBuffer(player) }
}

function segmentLoaderWithinForwardBuffer(player: () => ForwardBuffers): FragmentLoaderConstructor {
  return class SegmentLoader implements Loader<FragmentLoaderContext> {
    private readonly network: Loader<FragmentLoaderContext>

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
      const maxTimeToFirstByteMs = firstByteWaitMs(
        loadPolicy.maxTimeToFirstByteMs,
        forwardBufferMs(player()),
      )
      this.network.load(
        context,
        { ...config, loadPolicy: { ...loadPolicy, maxTimeToFirstByteMs } },
        callbacks,
      )
    }

    abort() {
      this.network.abort()
    }

    destroy() {
      this.network.destroy()
    }
  }
}

// A request that gives up still leaves the default wait in the buffer, so the request hls.js makes
// next, usually at a lower variant, has as long as any request had before playback would stall.
function firstByteWaitMs(defaultWaitMs: number, forwardBufferMs: number): number {
  return Math.max(
    defaultWaitMs,
    Math.min(STARTING_VARIANT_WAIT_MS, forwardBufferMs - defaultWaitMs),
  )
}

function forwardBufferMs({
  mainForwardBufferInfo,
  audioForwardBufferInfo,
}: ForwardBuffers): number {
  const main = mainForwardBufferInfo?.len ?? 0
  const audio = audioForwardBufferInfo?.len ?? main
  return Math.min(main, audio) * 1000
}
