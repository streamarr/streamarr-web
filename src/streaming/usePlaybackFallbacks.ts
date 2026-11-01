import { useCallback, useEffect, useState } from 'react'
import type { PlaybackFormatChange } from '../graphql/generated/graphql'
import type { QualityChoices } from './qualityChoices'

const NOTICE_DURATION_MS = 6_000

const CONVERTED =
  "This video couldn't play in its original form, so a converted version is playing."
const OPEN_THE_QUALITY_MENU = 'To choose another quality, open the Quality menu.'

type Fallback = 'changed-to-auto' | 'converted' | 'dolby-vision-stripped'

const NOTICES: Record<Fallback, string> = {
  'changed-to-auto': `${CONVERTED} Quality is now set to Auto. ${OPEN_THE_QUALITY_MENU}`,
  converted: `${CONVERTED} ${OPEN_THE_QUALITY_MENU}`,
  'dolby-vision-stripped':
    "This video couldn't play in Dolby Vision, so the HDR version is playing.",
}

/** What a playing stream tells the player when it attaches. */
export type FollowPlayingChoices = (qualities: QualityChoices) => void

export interface PlaybackFallbacks {
  /** The text over the video after the latest fallback, until it disappears by itself. */
  notice: { text: string; serial: number } | null
  /**
   * Returns what to tell about each stream that one playback session attaches, so that session
   * announces each format change once.
   */
  followPlaybackSession: () => FollowPlayingChoices
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
  return playing === requested ? 'converted' : 'changed-to-auto'
}

/** The notice after each fallback during a viewing. */
export function usePlaybackFallbacks(): PlaybackFallbacks {
  const [notice, setNotice] = useState<PlaybackFallbacks['notice']>(null)

  useEffect(() => {
    if (!notice) {
      return undefined
    }
    const timer = setTimeout(() => setNotice(null), NOTICE_DURATION_MS)
    return () => clearTimeout(timer)
  }, [notice])

  const followPlaybackSession = useCallback(() => {
    let announced: PlaybackFormatChange | null = null
    return (qualities: QualityChoices) => {
      const previous = announced
      announced = qualities.formatChange
      const fallback = fallbackOf(qualities)
      if (!fallback || qualities.formatChange === previous) {
        return
      }
      const text = NOTICES[fallback]
      setNotice((shown) => ({ text, serial: (shown?.serial ?? 0) + 1 }))
    }
  }, [])

  return { notice, followPlaybackSession }
}
