import { describe, expect, it } from 'vitest'
import type { ActiveStreamFieldsFragment } from '../../graphql/generated/graphql'
import {
  type ActiveStreamsAction,
  NO_ACTIVE_STREAMS_READ,
  reduceActiveStreams,
} from './activeStreamsList'

function stream(playbackSessionId: string): ActiveStreamFieldsFragment {
  return {
    playbackSessionId,
    profile: { id: 'profile-1', name: 'Ada' },
    deviceName: null,
    mediaFileId: `file-${playbackSessionId}`,
    media: null,
    positionSeconds: 0,
    producedRange: null,
    state: 'PLAYING',
    decision: null,
    workers: [],
  }
}

function after(...actions: ActiveStreamsAction[]) {
  return actions.reduce(reduceActiveStreams, NO_ACTIVE_STREAMS_READ)
}

function listedIds(state: ReturnType<typeof after>): string[] | null {
  return state.streams && [...state.streams.keys()]
}

describe('activeStreamsList', () => {
  it('shouldKeepTheNewerReadsStreamsWhenAnOlderReadAnswersAfterIt', () => {
    const state = after(
      { kind: 'reading', read: 1 },
      { kind: 'reading', read: 2 },
      { kind: 'read', read: 2, streams: [stream('newer')] },
      { kind: 'read', read: 1, streams: [stream('older')] },
    )

    expect(listedIds(state)).toEqual(['newer'])
  })

  it('shouldKeepTheStreamsWithoutAFailureWhenAnOlderReadFailsAfterANewerAnswered', () => {
    const state = after(
      { kind: 'reading', read: 1 },
      { kind: 'reading', read: 2 },
      { kind: 'read', read: 2, streams: [stream('newer')] },
      { kind: 'readFailed', read: 1, failure: new Error('Internal failure') },
    )

    expect(state.failure).toBeNull()
    expect(listedIds(state)).toEqual(['newer'])
  })

  it('shouldTakeOnlyTheChangesSinceTheNewestReadBeganWhenItAnswers', () => {
    const state = after(
      { kind: 'reading', read: 1 },
      { kind: 'read', read: 1, streams: [stream('a')] },
      { kind: 'changed', playbackSessionId: 'b', stream: stream('b') },
      { kind: 'reading', read: 2 },
      { kind: 'changed', playbackSessionId: 'c', stream: stream('c') },
      { kind: 'read', read: 2, streams: [stream('a')] },
    )

    expect(listedIds(state)).toEqual(['a', 'c'])
  })

  it('shouldKeepTheFirstReasonWhenLiveChangesStopTwice', () => {
    const state = after({ kind: 'stopped', stop: 'forbidden' }, { kind: 'stopped', stop: 'failed' })

    expect(state.liveStop).toBe('forbidden')
  })
})
