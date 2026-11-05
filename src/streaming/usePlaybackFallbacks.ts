import { useCallback, useEffect, useState } from 'react'
import type { PlaybackFormatChange, VideoQuality } from '../graphql/generated/graphql'
import type { QualityChoices } from './qualityChoices'

const NOTICE_DURATION_MS = 6_000

const CONVERTED =
  "This video couldn't play in its original form, so a converted version is playing."
const OPEN_THE_QUALITY_MENU = 'To choose another quality, open the Quality menu.'

type Fallback = 'changed-to-auto' | 'converted' | 'dolby-vision-stripped' | 'audio-track-switched'

const NOTICES: Record<Fallback, string> = {
  'changed-to-auto': `${CONVERTED} Quality is now set to Auto. ${OPEN_THE_QUALITY_MENU}`,
  converted: `${CONVERTED} ${OPEN_THE_QUALITY_MENU}`,
  'dolby-vision-stripped':
    "This video couldn't play in Dolby Vision, so the HDR version is playing.",
  'audio-track-switched': `The audio track you chose plays in a converted version. Quality is now set to Auto. ${OPEN_THE_QUALITY_MENU}`,
}

const EXPLANATIONS: Record<Fallback, string> = {
  'changed-to-auto': "This video couldn't play in its original form, so Quality changed to Auto.",
  converted:
    "This video couldn't play in its original form at this quality, so a converted version is playing.",
  'dolby-vision-stripped': NOTICES['dolby-vision-stripped'],
  'audio-track-switched':
    'The audio track you chose plays in a converted version, so Quality changed to Auto.',
}

/** The explanation beside each playback choice whose output fell back during the viewing. */
export type QualityMarks = ReadonlyMap<VideoQuality, string>

const NO_MARKS: QualityMarks = new Map()

/** What a stream tells the player once it shows its first frame. */
export type FollowPlayingChoices = (qualities: QualityChoices) => void

export interface PlaybackFallbacks {
  /** The text over the video after the latest fallback, until it disappears by itself. */
  notice: { text: string; serial: number } | null
  marks: QualityMarks
  /**
   * Starts following a new playback session, which takes down the notice about an earlier one, and
   * returns what to tell about each stream it shows, so that it announces each format change once.
   */
  followPlaybackSession: () => FollowPlayingChoices
  /** Shows a text of the caller's own over the video, as a fallback's notice shows. */
  announce: (text: string) => void
}

// Every change but the Dolby Vision copy plays a converted version, including a change the
// server adds after this client, so its notice stays true.
function fallbackOf({ requested, playing, formatChange }: QualityChoices): Fallback | undefined {
  if (formatChange === null) {
    return undefined
  }
  if (formatChange === 'DOLBY_VISION_STRIPPED') {
    return 'dolby-vision-stripped'
  }
  if (formatChange === 'AUDIO_TRACK_SWITCHED') {
    return 'audio-track-switched'
  }
  return playing === requested ? 'converted' : 'changed-to-auto'
}

// The requested choice keeps a mark while its output falls back, and loses it once it plays the
// output it asked for. Each fallback replaces the explanation the choice had.
function markFallback(marks: QualityMarks, qualities: QualityChoices): QualityMarks {
  const fallback = fallbackOf(qualities)
  const next = new Map(marks)
  if (!fallback) {
    next.delete(qualities.requested)
    return next
  }
  next.set(qualities.requested, EXPLANATIONS[fallback])
  return next
}

/**
 * The notice after each fallback during a viewing, and the marks it leaves in the quality menu.
 * Pass a new `viewing` object once the viewer leaves the media title: its first playback session
 * starts without marks.
 */
export function usePlaybackFallbacks(viewing: object): PlaybackFallbacks {
  const [notice, setNotice] = useState<PlaybackFallbacks['notice']>(null)
  const [marked, setMarked] = useState({ viewing, marks: NO_MARKS })

  const announce = useCallback((text: string) => {
    setNotice((shown) => ({ text, serial: (shown?.serial ?? 0) + 1 }))
  }, [])

  useEffect(() => {
    if (!notice) {
      return undefined
    }
    const timer = setTimeout(() => setNotice(null), NOTICE_DURATION_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const followPlaybackSession = useCallback(() => {
    setNotice(null)
    setMarked((current) => (current.viewing === viewing ? current : { viewing, marks: NO_MARKS }))
    let announced: PlaybackFormatChange | null = null
    return (qualities: QualityChoices) => {
      setMarked((current) => ({ viewing, marks: markFallback(current.marks, qualities) }))
      const previous = announced
      announced = qualities.formatChange
      const fallback = fallbackOf(qualities)
      if (!fallback || qualities.formatChange === previous) {
        return
      }
      announce(NOTICES[fallback])
    }
  }, [viewing, announce])

  return { notice, marks: marked.marks, followPlaybackSession, announce }
}
