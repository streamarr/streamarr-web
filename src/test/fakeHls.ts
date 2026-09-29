import { vi } from 'vitest'

type HlsListener = (event: string, data: unknown) => void

export interface FakeHlsTrack {
  name: string
  lang?: string
}

const listeners = new Map<string, Set<HlsListener>>()

/** What every hls.js instance a test creates shares: its method spies and its track state. */
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
  emit: (event: string) => listeners.get(event)?.forEach((listener) => listener(event, {})),
  supported: true,
  audioTracks: [] as FakeHlsTrack[],
  audioTrack: -1,
  subtitleTracks: [] as FakeHlsTrack[],
  subtitleTrack: -1,
}

export function resetFakeHls() {
  listeners.clear()
  hls.supported = true
  hls.audioTracks = []
  hls.audioTrack = -1
  hls.subtitleTracks = []
  hls.subtitleTrack = -1
}

class FakeHls {
  static Events = {
    ERROR: 'hlsError',
    AUDIO_TRACKS_UPDATED: 'hlsAudioTracksUpdated',
    AUDIO_TRACK_SWITCHING: 'hlsAudioTrackSwitching',
    SUBTITLE_TRACKS_UPDATED: 'hlsSubtitleTracksUpdated',
    SUBTITLE_TRACK_SWITCH: 'hlsSubtitleTrackSwitch',
  }
  static isSupported() {
    return hls.supported
  }
  loadSource = hls.loadSource
  attachMedia = hls.attachMedia
  destroy = hls.destroy
  on = hls.on
  off = hls.off
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
}

/** The hls.js module jsdom cannot run: `vi.mock('hls.js', async () => (await import(…)).hlsModule)`. */
export const hlsModule = { default: FakeHls }
