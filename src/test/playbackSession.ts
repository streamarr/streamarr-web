import type {
  PlaybackSessionFieldsFragment,
  DestroyPlaybackSessionMutation,
  DestroyPlaybackSessionMutationVariables,
} from '../graphql/generated/graphql'

type ReadyAttempt = Extract<
  PlaybackSessionFieldsFragment['currentFormatAttempt'],
  { __typename: 'ReadyPlaybackFormatAttempt' }
>
type StreamSession = ReadyAttempt['streamSession']
type PlaybackChoices = Pick<
  PlaybackSessionFieldsFragment,
  'requestedChoice' | 'playbackChoice' | 'formatChange' | 'offeredChoices'
>

/** What the server lists for a 1080p source. */
export const OFFERED_FOR_FULL_HD: PlaybackSessionFieldsFragment['offeredChoices'] = [
  'ORIGINAL',
  'AUTO',
  'FULL_HD_1080P',
  'HIGH_720P',
  'MEDIUM_480P',
  'LOW_360P',
]

/** A playback session that plays Auto, as the viewer asked, from an SDR stream with no known end. */
export function readyPlaybackSession({
  streamSession,
  id = `playback-${streamSession.id}`,
  ...choices
}: {
  streamSession: Pick<StreamSession, 'id' | 'streamUrl' | 'transcodeMode'> & Partial<StreamSession>
  id?: string
} & Partial<PlaybackChoices>): PlaybackSessionFieldsFragment {
  return {
    id,
    formatAttemptCount: 1,
    maximumFormatAttempts: 4,
    requestedChoice: 'AUTO',
    playbackChoice: 'AUTO',
    formatChange: null,
    offeredChoices: OFFERED_FOR_FULL_HD,
    ...choices,
    currentFormatAttempt: {
      __typename: 'ReadyPlaybackFormatAttempt',
      streamSession: { videoRange: 'SDR', mediaEndSeconds: null, ...streamSession },
    },
  }
}

export function destroyedPlaybackSession(variables: Record<string, unknown>) {
  const { playbackSessionId } = variables.input as DestroyPlaybackSessionMutationVariables['input']
  return { playbackSessionId: String(playbackSessionId), userErrors: [] } satisfies NonNullable<
    DestroyPlaybackSessionMutation['destroyPlaybackSession']
  >
}
