import { useSyncExternalStore } from 'react'
import { NO_TRACKS, type StreamTracks, type TrackSource } from './trackSources'

const noUnsubscribe = () => undefined
const subscribeToNothing = () => noUnsubscribe
const readNoTracks = () => NO_TRACKS

/** The attached stream's tracks, re-read whenever it reports a change; none without a stream. */
export function useStreamTracks(source: TrackSource | null): StreamTracks {
  return useSyncExternalStore(source?.subscribe ?? subscribeToNothing, source?.read ?? readNoTracks)
}
