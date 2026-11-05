import type {
  PlaybackSessionFieldsFragment,
  DestroyPlaybackSessionMutation,
  DestroyPlaybackSessionMutationVariables,
} from '../graphql/generated/graphql'

type ReadyAttempt = Extract<
  PlaybackSessionFieldsFragment['currentFormatAttempt'],
  { __typename: 'ReadyPlaybackFormatAttempt' }
>
type HlsStreamSession = Extract<ReadyAttempt['streamSession'], { __typename: 'HlsStreamSession' }>
type DirectPlayStreamSession = Extract<
  ReadyAttempt['streamSession'],
  { __typename: 'DirectPlayStreamSession' }
>
/** One of the audio tracks the server lists for a direct-played file. */
export type DirectPlayAudioTrack = DirectPlayStreamSession['audioTracks'][number]
/** The fields that say which playback choice was asked for, which plays, and why they differ. */
export type PlaybackChoices = Pick<
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
  streamSession: Pick<HlsStreamSession, 'id' | 'streamUrl' | 'transcodeMode'> &
    Partial<HlsStreamSession>
  id?: string
} & Partial<PlaybackChoices>): PlaybackSessionFieldsFragment {
  return readyOn({
    id,
    choices,
    streamSession: {
      __typename: 'HlsStreamSession',
      videoRange: 'SDR',
      mediaEndSeconds: null,
      ...streamSession,
    },
  })
}

/**
 * A playback session that plays Original, as the viewer asked, by direct play of an SDR MP4 file
 * whose first audio track plays.
 */
export function readyDirectPlaySession({
  streamSession,
  id = `playback-${streamSession.id}`,
  ...choices
}: {
  streamSession: Pick<DirectPlayStreamSession, 'id' | 'streamUrl'> &
    Partial<DirectPlayStreamSession>
  id?: string
} & Partial<PlaybackChoices>): PlaybackSessionFieldsFragment {
  return readyOn({
    id,
    choices: { requestedChoice: 'ORIGINAL', playbackChoice: 'ORIGINAL', ...choices },
    streamSession: {
      __typename: 'DirectPlayStreamSession',
      sourceContainer: 'MP4',
      videoRange: 'SDR',
      audioTrackPosition: 0,
      audioTracks: [],
      ...streamSession,
    },
  })
}

function readyOn({
  id,
  choices,
  streamSession,
}: {
  id: string
  choices: Partial<PlaybackChoices>
  streamSession: ReadyAttempt['streamSession']
}): PlaybackSessionFieldsFragment {
  return {
    id,
    formatAttemptCount: 1,
    maximumFormatAttempts: 4,
    requestedChoice: 'AUTO',
    playbackChoice: 'AUTO',
    formatChange: null,
    offeredChoices: OFFERED_FOR_FULL_HD,
    ...choices,
    currentFormatAttempt: { __typename: 'ReadyPlaybackFormatAttempt', streamSession },
  }
}

export function destroyedPlaybackSession(variables: Record<string, unknown>) {
  const { playbackSessionId } = variables.input as DestroyPlaybackSessionMutationVariables['input']
  return { playbackSessionId: String(playbackSessionId), userErrors: [] } satisfies NonNullable<
    DestroyPlaybackSessionMutation['destroyPlaybackSession']
  >
}
