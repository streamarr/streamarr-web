import type { BufferInfo, HlsConfig } from 'hls.js'
import { vi } from 'vitest'

type HlsListener = (event: string, data: unknown) => void

export interface FakeHlsTrack {
  name: string
  lang?: string
  audioCodec?: string
  /** The rendition's CHANNELS attribute. */
  channels?: string
}

/** A variant as hls.js parses it from the multivariant playlist. */
export interface FakeHlsLevel {
  height: number
  bitrate: number
  videoCodec?: string
  audioCodec?: string
  /** The SUPPLEMENTAL-CODECS of the variant, as Dolby Vision on a compatible base names it. */
  supplemental?: { videoCodec?: string }
}

const listeners = new Map<string, Set<HlsListener>>()

/** What every hls.js instance a test creates shares: its method spies, its settings, its track state and its forward buffers. */
export const hls = {
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn((event: string, listener: HlsListener) => {
    listeners.set(event, (listeners.get(event) ?? new Set()).add(listener))
  }),
  off: vi.fn((event: string, listener: HlsListener) => {
    listeners.get(event)?.delete(listener)
  }),
  emit: (event: string, data: unknown = {}) =>
    listeners.get(event)?.forEach((listener) => listener(event, data)),
  /** Like hls.js, hands the event to its listeners. */
  trigger: vi.fn((event: string, data: unknown) => {
    hls.emit(event, data)
    return true
  }),
  supported: true,
  audioTracks: [] as FakeHlsTrack[],
  audioTrack: -1,
  subtitleTracks: [] as FakeHlsTrack[],
  subtitleTrack: -1,
  config: undefined as Partial<HlsConfig> | undefined,
  mainForwardBufferInfo: null as BufferInfo | null,
  audioForwardBufferInfo: null as BufferInfo | null,
  latestLevelDetails: null as { targetduration: number } | null,
  levels: [] as FakeHlsLevel[],
  currentLevel: -1,
  bandwidthEstimate: Number.NaN,
}

export function resetFakeHls() {
  listeners.clear()
  hls.supported = true
  hls.audioTracks = []
  hls.audioTrack = -1
  hls.subtitleTracks = []
  hls.subtitleTrack = -1
  hls.config = undefined
  hls.mainForwardBufferInfo = null
  hls.audioForwardBufferInfo = null
  hls.latestLevelDetails = null
  hls.levels = []
  hls.currentLevel = -1
  hls.bandwidthEstimate = Number.NaN
}

class FakeHls {
  static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' }
  static ErrorDetails = {
    MANIFEST_INCOMPATIBLE_CODECS_ERROR: 'manifestIncompatibleCodecsError',
    BUFFER_INCOMPATIBLE_CODECS_ERROR: 'bufferIncompatibleCodecsError',
    BUFFER_ADD_CODEC_ERROR: 'bufferAddCodecError',
    FRAG_LOAD_TIMEOUT: 'fragLoadTimeOut',
  }
  static Events = {
    ERROR: 'hlsError',
    AUDIO_TRACKS_UPDATED: 'hlsAudioTracksUpdated',
    AUDIO_TRACK_SWITCHING: 'hlsAudioTrackSwitching',
    SUBTITLE_TRACKS_UPDATED: 'hlsSubtitleTracksUpdated',
    SUBTITLE_TRACK_SWITCH: 'hlsSubtitleTrackSwitch',
    FRAG_BUFFERED: 'hlsFragBuffered',
    BUFFER_EOS: 'hlsBufferEos',
  }
  static isSupported() {
    return hls.supported
  }
  constructor(config?: Partial<HlsConfig>) {
    hls.config = config
  }
  loadSource = hls.loadSource
  attachMedia = hls.attachMedia
  destroy = hls.destroy
  on = hls.on
  off = hls.off
  trigger = hls.trigger
  get audioTracks() {
    return hls.audioTracks
  }
  get audioTrack() {
    return hls.audioTrack
  }
  set audioTrack(id: number) {
    hls.audioTrack = id
    hls.emit(FakeHls.Events.AUDIO_TRACK_SWITCHING)
  }
  get subtitleTracks() {
    return hls.subtitleTracks
  }
  get subtitleTrack() {
    return hls.subtitleTrack
  }
  set subtitleTrack(id: number) {
    hls.subtitleTrack = id
    hls.emit(FakeHls.Events.SUBTITLE_TRACK_SWITCH)
  }
  get mainForwardBufferInfo() {
    return hls.mainForwardBufferInfo
  }
  get audioForwardBufferInfo() {
    return hls.audioForwardBufferInfo
  }
  get latestLevelDetails() {
    return hls.latestLevelDetails
  }
  get levels() {
    return hls.levels
  }
  get currentLevel() {
    return hls.currentLevel
  }
  get bandwidthEstimate() {
    return hls.bandwidthEstimate
  }
}

/** Mock hls.js with it: `vi.mock('hls.js', async () => (await import(…)).hlsModule)`. */
export const hlsModule = {
  default: FakeHls,
  PlaylistLevelType: { MAIN: 'main', AUDIO: 'audio', SUBTITLE: 'subtitle' },
}
