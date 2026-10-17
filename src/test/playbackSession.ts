import type {
  PlaybackSessionFieldsFragment,
  DestroyPlaybackSessionMutation,
  DestroyPlaybackSessionMutationVariables,
} from '../graphql/generated/graphql'

type ReadyAttempt = Extract<
  PlaybackSessionFieldsFragment['currentFormatAttempt'],
  { __typename: 'ReadyPlaybackFormatAttempt' }
>

export function readyPlaybackSession({
  streamSession,
  id = `playback-${streamSession.id}`,
}: {
  streamSession: ReadyAttempt['streamSession']
  id?: string
}): PlaybackSessionFieldsFragment {
  return {
    id,
    formatAttemptCount: 1,
    maximumFormatAttempts: 3,
    currentFormatAttempt: { __typename: 'ReadyPlaybackFormatAttempt', streamSession },
  }
}

export function destroyedPlaybackSession(variables: Record<string, unknown>) {
  const { playbackSessionId } = variables.input as DestroyPlaybackSessionMutationVariables['input']
  return { playbackSessionId: String(playbackSessionId), userErrors: [] } satisfies NonNullable<
    DestroyPlaybackSessionMutation['destroyPlaybackSession']
  >
}
