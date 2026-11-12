import { useCallback, useState } from 'react'
import type { VideoQuality } from '../graphql/generated/graphql'
import type { QualityChoices } from './qualityChoices'

type Fallback =
  | 'changed-to-auto'
  | 'converted'
  | 'dolby-vision-stripped'
  | 'audio-track-switched'
  | 'hdr-not-played'
  | 'hdr-not-kept'
  | 'auto-hdr-not-kept'

const EXPLANATIONS: Record<Fallback, string> = {
  'changed-to-auto': "This video couldn't play in its original form, so Quality changed to Auto.",
  converted:
    "This video couldn't play in its original form at this quality, so a converted version is playing.",
  'dolby-vision-stripped':
    "This video couldn't play in Dolby Vision, so the HDR version is playing.",
  'audio-track-switched':
    'The audio track you chose plays in a converted version, so Quality changed to Auto.',
  'hdr-not-played': "This video couldn't play in HDR at this quality, so it's playing in SDR.",
  'hdr-not-kept': "This video couldn't stay in HDR at this quality, so it's playing in SDR.",
  'auto-hdr-not-kept': "This video couldn't stay in HDR, so it's playing in SDR.",
}

const AUDIO_SWITCH_REFUSED = "The audio track you chose couldn't play, so the audio didn't change."

/** The explanation beside each playback choice whose output differed from it during the viewing. */
export type QualityMarks = ReadonlyMap<VideoQuality, string>

/** The caution on the quality control: its message, and the choice whose row the message explains. */
export interface QualityCaution {
  message: string
  choice: VideoQuality
}

/**
 * The cautions on the player's controls while what plays differs from what the viewer chose: on
 * the quality control after a format change, and on the audio control after a refused switch.
 */
export interface PlaybackCautions {
  quality?: QualityCaution
  audio?: string
}

/** A caution's message for assistive technology; each new serial is announced once. */
export interface CautionAnnouncement {
  text: string
  serial: number
}

/** What a stream tells the player once it shows its first frame. */
export type FollowPlayingChoices = (qualities: QualityChoices) => void

export interface PlaybackFallbacks {
  marks: QualityMarks
  cautions: PlaybackCautions
  /** The message of the caution that appeared or changed last, while that caution stands. */
  announcement: CautionAnnouncement | null
  /**
   * Starts following a new playback session, which takes down the quality caution of the one
   * before, and returns what to tell about each stream it shows.
   */
  followPlaybackSession: () => FollowPlayingChoices
  /** Cautions on the audio control that the server refused the viewer's audio switch. */
  refuseAudioSwitch: () => void
  /** Hears the viewer pick any audio track, which takes down the audio control's caution. */
  pickAudio: () => void
}

interface ViewingCautions {
  viewing: object
  marks: QualityMarks
  cautions: PlaybackCautions
  announcement: CautionAnnouncement | null
}

function startViewing(viewing: object): ViewingCautions {
  return { viewing, marks: new Map(), cautions: {}, announcement: null }
}

// Every change but the Dolby Vision copy and the lost HDR plays a converted version, including a
// change the server adds after this client. A choice that showed HDR during the playback session
// could not stay in HDR; one that never did could not play in it.
function fallbackOf(
  { requested, playing, formatChange }: QualityChoices,
  shownHdr: boolean,
): Fallback | undefined {
  switch (formatChange) {
    case null:
      return undefined
    case 'DOLBY_VISION_STRIPPED':
      return 'dolby-vision-stripped'
    case 'AUDIO_TRACK_SWITCHED':
      return 'audio-track-switched'
    case 'HDR_NOT_KEPT':
      return hdrFallback(playing, shownHdr)
    default:
      return playing === requested ? 'converted' : 'changed-to-auto'
  }
}

function hdrFallback(playing: VideoQuality, shownHdr: boolean): Fallback {
  if (playing === 'AUTO') {
    return 'auto-hdr-not-kept'
  }
  return shownHdr ? 'hdr-not-kept' : 'hdr-not-played'
}

// The requested choice keeps a mark while its output differs, and loses it once it plays the
// output it asked for. Each change replaces the explanation the choice had.
function markFallback(
  marks: QualityMarks,
  requested: VideoQuality,
  explanation: string | undefined,
): QualityMarks {
  const next = new Map(marks)
  if (!explanation) {
    next.delete(requested)
    return next
  }
  next.set(requested, explanation)
  return next
}

// A caution that appears, or whose message changes, is announced; one that stays as it is is not.
function withCautions(state: ViewingCautions, cautions: PlaybackCautions): ViewingCautions {
  const appeared = [
    [state.cautions.quality?.message, cautions.quality?.message],
    [state.cautions.audio, cautions.audio],
  ].findLast(([before, after]) => after !== undefined && after !== before)?.[1]
  if (!appeared) {
    return { ...state, cautions }
  }
  const serial = (state.announcement?.serial ?? 0) + 1
  return { ...state, cautions, announcement: { text: appeared, serial } }
}

// The output that a stream shows sets the quality caution and the requested choice's mark.
function afterOutputShown(
  state: ViewingCautions,
  requested: VideoQuality,
  explanation: string | undefined,
): ViewingCautions {
  let quality: QualityCaution | undefined
  if (explanation) {
    quality = { message: explanation, choice: requested }
  }
  return {
    ...withCautions(state, { ...state.cautions, quality }),
    marks: markFallback(state.marks, requested, explanation),
  }
}

function standingAnnouncement({
  announcement,
  cautions,
}: ViewingCautions): CautionAnnouncement | null {
  const standing = [cautions.quality?.message, cautions.audio]
  return announcement && standing.includes(announcement.text) ? announcement : null
}

/**
 * The cautions on the player's controls, and the marks they leave in the quality menu, during a
 * viewing. Pass a new `viewing` object once the viewer leaves the media title: it starts without
 * cautions or marks.
 */
export function usePlaybackFallbacks(viewing: object): PlaybackFallbacks {
  const [state, setState] = useState(() => startViewing(viewing))
  const current = state.viewing === viewing ? state : startViewing(viewing)

  const update = useCallback(
    (change: (state: ViewingCautions) => ViewingCautions) =>
      setState((latest) => change(latest.viewing === viewing ? latest : startViewing(viewing))),
    [viewing],
  )

  const followPlaybackSession = useCallback(() => {
    update((latest) => withCautions(latest, { ...latest.cautions, quality: undefined }))
    let shownHdr = false
    return (qualities: QualityChoices) => {
      const fallback = fallbackOf(qualities, shownHdr)
      shownHdr ||= qualities.videoRange !== 'SDR'
      update((latest) =>
        afterOutputShown(latest, qualities.requested, fallback && EXPLANATIONS[fallback]),
      )
    }
  }, [update])

  const refuseAudioSwitch = useCallback(
    () =>
      update((latest) => withCautions(latest, { ...latest.cautions, audio: AUDIO_SWITCH_REFUSED })),
    [update],
  )

  const pickAudio = useCallback(
    () => update((latest) => withCautions(latest, { ...latest.cautions, audio: undefined })),
    [update],
  )

  return {
    marks: current.marks,
    cautions: current.cautions,
    announcement: standingAnnouncement(current),
    followPlaybackSession,
    refuseAudioSwitch,
    pickAudio,
  }
}
