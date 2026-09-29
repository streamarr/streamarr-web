import { useSyncExternalStore } from 'react'
import { NO_TRACKS, type PlaybackTracks, type TrackSource } from './trackSources'

const subscribeToNothing = () => () => undefined
const readNoTracks = () => NO_TRACKS

/** The attached stream's tracks, re-read whenever it reports a change; none without a stream. */
export function usePlaybackTracks(source: TrackSource | null): PlaybackTracks {
  return useSyncExternalStore(source?.subscribe ?? subscribeToNothing, source?.read ?? readNoTracks)
}
