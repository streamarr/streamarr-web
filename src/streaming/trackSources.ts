import Hls, { type MediaPlaylist } from 'hls.js'

export interface TrackOption {
  id: number
  label: string
}

/** The tracks of one kind a stream offers, and the one in use; null when none is. */
export interface TrackChoice {
  options: readonly TrackOption[]
  selected: number | null
}

export interface PlaybackTracks {
  audio: TrackChoice
  subtitles: TrackChoice
}

/** The audio and subtitle tracks of one attached stream. */
export interface TrackSource {
  /** Returns the same object until the tracks, or the choice among them, change. */
  read: () => PlaybackTracks
  subscribe: (onChange: () => void) => () => void
}

export const NO_TRACKS: PlaybackTracks = {
  audio: { options: [], selected: null },
  subtitles: { options: [], selected: null },
}

const HLS_TRACK_EVENTS = [
  Hls.Events.AUDIO_TRACKS_UPDATED,
  Hls.Events.AUDIO_TRACK_SWITCHING,
  Hls.Events.SUBTITLE_TRACKS_UPDATED,
  Hls.Events.SUBTITLE_TRACK_SWITCH,
] as const

type HlsTrack = Pick<MediaPlaylist, 'name' | 'lang'>

/** The part of an hls.js instance that lists the stream's tracks and switches between them. */
export interface HlsTracks {
  on: (event: (typeof HLS_TRACK_EVENTS)[number], listener: () => void) => void
  off: (event: (typeof HLS_TRACK_EVENTS)[number], listener: () => void) => void
  readonly audioTracks: readonly HlsTrack[]
  audioTrack: number
  readonly subtitleTracks: readonly HlsTrack[]
  subtitleTrack: number
}

export function hlsTrackSource(hls: HlsTracks): TrackSource {
  return {
    read: unchangedUntilDifferent(() => ({
      audio: choice(hls.audioTracks.map(hlsTrackOption), hls.audioTrack),
      subtitles: choice(hls.subtitleTracks.map(hlsTrackOption), hls.subtitleTrack),
    })),
    subscribe: (onChange) => {
      for (const event of HLS_TRACK_EVENTS) {
        hls.on(event, onChange)
      }
      return () => {
        for (const event of HLS_TRACK_EVENTS) {
          hls.off(event, onChange)
        }
      }
    },
  }
}

const TRACK_LIST_EVENTS = ['addtrack', 'removetrack', 'change'] as const

interface ElementTrack {
  label?: string
  language?: string
}

interface ElementAudioTrack extends ElementTrack {
  enabled: boolean
}

/** Reads the tracks a browser that plays HLS itself lists on the element. */
export function nativeTrackSource(video: HTMLVideoElement): TrackSource {
  return {
    read: unchangedUntilDifferent(() => {
      const audio = audioTracksOf(video)
      const subtitles = subtitleTracksOf(video)
      return {
        audio: choice(
          audio.map(elementTrackOption),
          audio.findIndex((track) => track.enabled),
        ),
        subtitles: choice(
          subtitles.map(elementTrackOption),
          subtitles.findIndex((track) => track.mode === 'showing'),
        ),
      }
    }),
    subscribe: (onChange) => {
      const stops = [audioTrackListOf(video), video.textTracks].map((list) =>
        listenToTrackList(list, onChange),
      )
      return () => stops.forEach((stop) => stop())
    },
  }
}

// lib.dom does not declare audioTracks, and only some browsers implement it.
function audioTrackListOf(video: HTMLVideoElement): unknown {
  return Reflect.get(video, 'audioTracks')
}

function audioTracksOf(video: HTMLVideoElement): ElementAudioTrack[] {
  const list = audioTrackListOf(video)
  return isArrayLike(list) ? Array.from(list).filter(isElementAudioTrack) : []
}

function subtitleTracksOf(video: HTMLVideoElement): TextTrack[] {
  return Array.from(video.textTracks).filter(
    (track) => track.kind === 'subtitles' || track.kind === 'captions',
  )
}

function listenToTrackList(list: unknown, onChange: () => void): () => void {
  if (!(list instanceof EventTarget)) {
    return () => undefined
  }
  for (const type of TRACK_LIST_EVENTS) {
    list.addEventListener(type, onChange)
  }
  return () => {
    for (const type of TRACK_LIST_EVENTS) {
      list.removeEventListener(type, onChange)
    }
  }
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'length') === 'number'
  )
}

function isElementAudioTrack(value: unknown): value is ElementAudioTrack {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'enabled') === 'boolean'
  )
}

function choice(options: TrackOption[], selectedIndex: number): TrackChoice {
  const selected = selectedIndex >= 0 && selectedIndex < options.length ? selectedIndex : null
  return { options, selected }
}

function hlsTrackOption(track: HlsTrack, index: number): TrackOption {
  return { id: index, label: trackLabel({ name: track.name, language: track.lang }, index) }
}

function elementTrackOption(track: ElementTrack, index: number): TrackOption {
  return { id: index, label: trackLabel({ name: track.label, language: track.language }, index) }
}

// The interface is in English, so the languages it names are too.
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' })

function trackLabel(
  { name, language }: { name?: string; language?: string },
  index: number,
): string {
  if (name) {
    return name
  }
  return languageName(language) ?? `Track ${index + 1}`
}

function languageName(code: string | undefined): string | undefined {
  if (!code) {
    return undefined
  }
  try {
    return languageNames.of(code)
  } catch {
    return undefined
  }
}

function unchangedUntilDifferent(read: () => PlaybackTracks): () => PlaybackTracks {
  let tracks = NO_TRACKS
  let fingerprint = JSON.stringify(NO_TRACKS)
  return () => {
    const next = read()
    const nextFingerprint = JSON.stringify(next)
    if (nextFingerprint !== fingerprint) {
      tracks = next
      fingerprint = nextFingerprint
    }
    return tracks
  }
}
