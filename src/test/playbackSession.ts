import type {
  AudioFormatFieldsFragment,
  PlaybackDecisionFieldsFragment,
  PlaybackSessionFieldsFragment,
  VideoFormatFieldsFragment,
  DestroyPlaybackSessionMutation,
  DestroyPlaybackSessionMutationVariables,
  VideoRange,
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

/**
 * A playback session that plays Auto, as the viewer asked, from an SDR stream with no known end.
 * With a `sourceRange`, its one decision names the source's dynamic range; without one, it has none.
 */
export function readyPlaybackSession({
  streamSession,
  id = `playback-${streamSession.id}`,
  sourceRange,
  ...choices
}: {
  streamSession: Pick<HlsStreamSession, 'id' | 'streamUrl' | 'transcodeMode'> &
    Partial<HlsStreamSession>
  id?: string
  sourceRange?: VideoRange
} & Partial<PlaybackChoices>): PlaybackSessionFieldsFragment {
  return readyOn({
    id,
    choices,
    decisions: sourceRange ? [{ video: { source: { videoRange: sourceRange } } }] : [],
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
      startPositionSeconds: null,
      audioTrackPosition: 0,
      audioTracks: [],
      ...streamSession,
    },
  })
}

function readyOn({
  id,
  choices,
  decisions = [],
  streamSession,
}: {
  id: string
  choices: Partial<PlaybackChoices>
  decisions?: PlaybackSessionFieldsFragment['decisions']
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
    decisions,
    currentFormatAttempt: { __typename: 'ReadyPlaybackFormatAttempt', streamSession },
  }
}

export function destroyedPlaybackSession(variables: Record<string, unknown>) {
  const { playbackSessionId } = variables.input as DestroyPlaybackSessionMutationVariables['input']
  return { playbackSessionId: String(playbackSessionId), userErrors: [] } satisfies NonNullable<
    DestroyPlaybackSessionMutation['destroyPlaybackSession']
  >
}

/** A 1080p SDR H.264 video track at 8 Mb/s and 23.976 frames per second. */
export const H264_FULL_HD: VideoFormatFieldsFragment = {
  codec: 'h264',
  width: 1920,
  height: 1080,
  frameRate: 23.976,
  bitrate: 8_000_000,
  videoRange: 'SDR',
  dolbyVision: false,
  details: null,
}

/** A stereo AAC audio track at 192 kb/s. */
export const AAC_STEREO: AudioFormatFieldsFragment = { codec: 'aac', channels: 2, bitrate: 192_000 }

/**
 * The initial format attempt's decision for the stream session `streamSessionId`: it copies an SDR
 * 1080p H.264 video and its stereo AAC audio as the source holds them, so it names no reason.
 */
export function playbackDecision({
  streamSessionId,
  ...overrides
}: Pick<PlaybackDecisionFieldsFragment, 'streamSessionId'> &
  Partial<PlaybackDecisionFieldsFragment>): PlaybackDecisionFieldsFragment {
  return {
    formatAttempt: 1,
    streamSessionId,
    video: { delivery: 'COPY', source: H264_FULL_HD, output: H264_FULL_HD },
    audio: { delivery: 'COPY', source: AAC_STEREO, output: AAC_STEREO },
    reasons: [],
    ...overrides,
  }
}

/**
 * A decision as the server sends it: Apollo's cache matches each fragment on the __typename that
 * the client adds to every selection.
 */
export function servedDecision({ video, audio, ...decision }: PlaybackDecisionFieldsFragment) {
  return {
    __typename: 'PlaybackDecision',
    ...decision,
    video: {
      __typename: 'VideoDelivery',
      delivery: video.delivery,
      source: { __typename: 'VideoFormat', ...video.source },
      output: { __typename: 'VideoFormat', ...video.output },
    },
    audio: audio && {
      __typename: 'AudioDelivery',
      delivery: audio.delivery,
      source: { __typename: 'AudioFormat', ...audio.source },
      output: { __typename: 'AudioFormat', ...audio.output },
    },
  }
}
