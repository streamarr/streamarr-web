import type {
  BufferInfo,
  FragmentLoaderContext,
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from 'hls.js'

export interface NetworkLoad {
  context: LoaderContext
  config: LoaderConfiguration
  callbacks: LoaderCallbacks<LoaderContext>
}

/** Stands in for hls.js's network loader (`HlsConfig.loader`) and keeps every load it is asked to make. */
export function fakeNetworkLoader() {
  const loads: NetworkLoad[] = []
  const loaders: FakeNetworkLoader[] = []

  class FakeNetworkLoader implements Loader<LoaderContext> {
    context: LoaderContext | null = null
    stats: LoaderStats = emptyStats()
    destroyed = false

    constructor() {
      loaders.push(this)
    }

    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ) {
      this.context = context
      loads.push({ context, config, callbacks })
    }

    abort() {
      this.stats.aborted = true
    }

    destroy() {
      this.destroyed = true
    }
  }

  return { Loader: FakeNetworkLoader, loads, loaders }
}

/** The hls.js settings a segment loader is constructed with, around a network loader. */
export function hlsConfigWith(
  config: Partial<HlsConfig>,
  network: { Loader: HlsConfig['loader'] },
): HlsConfig {
  return { ...config, loader: network.Loader } as HlsConfig
}

/** What hls.js passes a segment load: its default media segment policy. */
export function segmentLoadConfiguration(): LoaderConfiguration {
  return {
    loadPolicy: {
      maxTimeToFirstByteMs: 10_000,
      maxLoadTimeMs: 120_000,
      timeoutRetry: null,
      errorRetry: null,
    },
    timeout: 120_000,
    maxRetry: 0,
    retryDelay: 0,
    maxRetryDelay: 0,
  }
}

/** What hls.js reports as a forward buffer that holds `seconds` ahead of the playhead. */
export function forwardBuffer(seconds: number): BufferInfo {
  return { len: seconds, start: 100, end: 100 + seconds, bufferedIndex: 0 }
}

export function segmentContext(): FragmentLoaderContext {
  return { url: 'segment.m4s', responseType: 'arraybuffer' } as FragmentLoaderContext
}

export function segmentCallbacks(): LoaderCallbacks<FragmentLoaderContext> {
  return { onSuccess: () => {}, onError: () => {}, onTimeout: () => {} }
}

function emptyStats(): LoaderStats {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  }
}
