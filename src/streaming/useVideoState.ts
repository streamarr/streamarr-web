import { type RefObject, useEffect, useState } from 'react'

export interface VideoState {
  paused: boolean
  currentTime: number
  /** NaN until the stream declares its length. */
  duration: number
  volume: number
  muted: boolean
}

const VIDEO_EVENTS = [
  'play',
  'pause',
  'timeupdate',
  'seeking',
  'durationchange',
  'volumechange',
  'emptied',
] as const

// An element that has not loaded anything reads this way, so the first render needs no read.
const UNLOADED: VideoState = {
  paused: true,
  currentTime: 0,
  duration: Number.NaN,
  volume: 1,
  muted: false,
}

/** The video element's transport state, re-read whenever the element reports a change. */
export function useVideoState(videoRef: RefObject<HTMLVideoElement | null>): VideoState {
  const [state, setState] = useState(UNLOADED)

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return undefined
    }
    const read = () =>
      setState({
        paused: video.paused,
        currentTime: video.currentTime,
        duration: video.duration,
        volume: video.volume,
        muted: video.muted,
      })
    for (const event of VIDEO_EVENTS) {
      video.addEventListener(event, read)
    }
    return () => {
      for (const event of VIDEO_EVENTS) {
        video.removeEventListener(event, read)
      }
    }
  }, [videoRef])

  return state
}
