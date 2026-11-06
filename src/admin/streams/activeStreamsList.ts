import type { ErrorLike } from '@apollo/client'
import type { ActiveStreamFieldsFragment } from '../../graphql/generated/graphql'

type ActiveStream = ActiveStreamFieldsFragment

/** Why live changes stopped: the server refused them, or they ended another way. */
export type LiveStreamsStop = 'forbidden' | 'failed'

/** The active streams as the newest read and the live changes since it describe them. */
export interface ActiveStreamsState {
  /** Every active stream by playback session id, in the order they were first listed; null before the first read. */
  streams: ReadonlyMap<string, ActiveStream> | null
  /** The number of the newest read; an older read's answer is stale. */
  read: number
  // A read can answer with a stream as it was before a change that arrived meanwhile, so each
  // change since the newest read began applies again over its answer.
  changesDuringRead: ReadonlyMap<string, ActiveStream | null>
  /** The newest read's failure; the streams it could not replace stay listed. */
  failure: ErrorLike | null
  liveStop: LiveStreamsStop | null
}

export type ActiveStreamsAction =
  | { kind: 'reading'; read: number }
  | { kind: 'read'; read: number; streams: readonly ActiveStream[] }
  | { kind: 'readFailed'; read: number; failure: ErrorLike }
  | { kind: 'changed'; playbackSessionId: string; stream: ActiveStream | null }
  | { kind: 'stopped'; stop: LiveStreamsStop }

export const NO_ACTIVE_STREAMS_READ: ActiveStreamsState = {
  streams: null,
  read: 0,
  changesDuringRead: new Map(),
  failure: null,
  liveStop: null,
}

/**
 * Applies a read or a live change. A read answers only if no newer read began since, and its
 * answer takes in again every change since it began.
 */
export function reduceActiveStreams(
  state: ActiveStreamsState,
  action: ActiveStreamsAction,
): ActiveStreamsState {
  switch (action.kind) {
    case 'reading':
      return { ...state, read: action.read, changesDuringRead: new Map() }
    case 'read':
      if (action.read !== state.read) return state
      return { ...state, streams: listed(action.streams, state.changesDuringRead), failure: null }
    case 'readFailed':
      if (action.read !== state.read) return state
      return { ...state, failure: action.failure }
    case 'changed':
      return {
        ...state,
        streams:
          state.streams && withChange(state.streams, action.playbackSessionId, action.stream),
        changesDuringRead: new Map(state.changesDuringRead).set(
          action.playbackSessionId,
          action.stream,
        ),
      }
    case 'stopped':
      return { ...state, liveStop: state.liveStop ?? action.stop }
  }
}

function listed(
  streams: readonly ActiveStream[],
  changes: ReadonlyMap<string, ActiveStream | null>,
): ReadonlyMap<string, ActiveStream> {
  let result: ReadonlyMap<string, ActiveStream> = new Map(
    streams.map((stream) => [stream.playbackSessionId, stream]),
  )
  for (const [playbackSessionId, stream] of changes) {
    result = withChange(result, playbackSessionId, stream)
  }
  return result
}

// A changed stream keeps its place; a new one goes last, and an ended one leaves.
function withChange(
  streams: ReadonlyMap<string, ActiveStream>,
  playbackSessionId: string,
  stream: ActiveStream | null,
): ReadonlyMap<string, ActiveStream> {
  const next = new Map(streams)
  if (stream) {
    next.set(playbackSessionId, stream)
    return next
  }
  next.delete(playbackSessionId)
  return next
}
