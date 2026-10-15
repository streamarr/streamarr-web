import { type RefObject, useEffect, useState } from 'react'

export interface VideoState {
  paused: boolean
  /** Playing, but stalled until more of the stream arrives. */
  buffering: boolean
  currentTime: number
  /** NaN until the stream declares its length. */
  duration: number
  volume: number
  muted: boolean
  /** The height of the frames in view; 0 before the first. */
  videoHeight: number
}

const VIDEO_EVENTS = [
  'play',
  'pause',
  'playing',
  'waiting',
  'timeupdate',
  'seeking',
  'durationchange',
  'volumechange',
  'resize',
  'emptied',
] as const

// An element that has not loaded anything reads this way, so the first render needs no read.
const UNLOADED: VideoState = {
  paused: true,
  buffering: false,
  currentTime: 0,
  duration: Number.NaN,
  volume: 1,
  muted: false,
  videoHeight: 0,
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
        buffering: !video.paused && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
        currentTime: video.currentTime,
        duration: video.duration,
        volume: video.volume,
        muted: video.muted,
        videoHeight: video.videoHeight,
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
