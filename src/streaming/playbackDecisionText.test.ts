import { describe, expect, it } from 'vitest'
import type {
  DecisionReason,
  PlaybackDecisionFieldsFragment,
  PlaybackDelivery,
  VideoQuality,
  VideoRange,
} from '../graphql/generated/graphql'
import { playbackDecision } from '../test/playbackSession'
import { audioRows, deliveryText, placedReasons, videoRows } from './playbackDecisionText'

type AudioDelivery = NonNullable<PlaybackDecisionFieldsFragment['audio']>

const TRUEHD_AS_EAC3: AudioDelivery = {
  delivery: 'ENCODE',
  source: { codec: 'truehd', channels: 8, bitrate: 4_600_000 },
  output: { codec: 'eac3', channels: 6, bitrate: 640_000 },
}

// A Dolby Vision 2160p HEVC source sent as a 1080p HDR10 encode, its 7.1 TrueHD audio as 5.1 E-AC-3.
const ENCODED_FOR_1080P = playbackDecision({
  streamSessionId: 'sess-1',
  video: {
    delivery: 'ENCODE',
    source: {
      codec: 'hevc',
      width: 3840,
      height: 2160,
      frameRate: 23.976,
      bitrate: 61_200_000,
      videoRange: 'PQ',
      dolbyVision: true,
    },
    output: {
      codec: 'hevc',
      width: 1920,
      height: 1080,
      frameRate: 23.976,
      bitrate: 38_400_000,
      videoRange: 'PQ',
      dolbyVision: false,
    },
  },
  audio: TRUEHD_AS_EAC3,
})

function reasonsOf(
  reasons: DecisionReason[],
  {
    decision = ENCODED_FOR_1080P,
    requestedChoice = 'FULL_HD_1080P',
  }: { decision?: PlaybackDecisionFieldsFragment; requestedChoice?: VideoQuality } = {},
) {
  return placedReasons({ decision: { ...decision, reasons }, requestedChoice })
}

describe('playbackDecisionText', () => {
  it.each<[DecisionReason, 'video' | 'audio' | 'stream', string]>([
    ['VIDEO_CODEC_NOT_DECLARED', 'video', "This device can't play the video's codec (HEVC)."],
    [
      'VIDEO_CODEC_PROFILE_NOT_DECLARED',
      'video',
      "This device plays HEVC, but not the video's profile.",
    ],
    [
      'VIDEO_CODEC_LEVEL_NOT_DECLARED',
      'video',
      "This device plays HEVC, but not the video's level.",
    ],
    ['VIDEO_BIT_DEPTH_NOT_DECLARED', 'video', "This device can't play the video's bit depth."],
    ['VIDEO_PICTURE_SIZE_NOT_DECLARED', 'video', "This device can't play 3840×2160 video."],
    ['VIDEO_FRAME_RATE_NOT_DECLARED', 'video', "This device can't play 23.976 fps video."],
    [
      'DYNAMIC_RANGE_NOT_DECLARED',
      'video',
      "This device can't show HDR10, so the server converts it.",
    ],
    [
      'DOLBY_VISION_NOT_DECLARED',
      'video',
      "This device can't play the video's Dolby Vision profile, so the server sends HDR10.",
    ],
    ['HDR10_PLUS_NOT_DECLARED', 'video', "This device can't play HDR10+."],
    [
      'PICTURE_ABOVE_VIEWER_LIMIT',
      'video',
      'You chose 1080p, so the server scales this 3840×2160 video down to 1080p.',
    ],
    [
      'BITRATE_ABOVE_VIEWER_LIMIT',
      'video',
      'You chose 1080p, so the server re-encodes this 61.2 Mb/s video to fit.',
    ],
    [
      'SOURCE_INTERLACED',
      'video',
      'The video is interlaced, and streaming needs progressive video.',
    ],
    [
      'DOLBY_VISION_WITHOUT_COMPATIBLE_BASE',
      'video',
      'The video is Dolby Vision with no HDR10 or SDR fallback, so the server converts it.',
    ],
    [
      'VIDEO_PROPERTIES_NOT_PROBED',
      'video',
      'An older server version read this video, so the server encodes it until it reads it again.',
    ],
    [
      'DOLBY_VISION_COMPATIBILITY_DISAGREES_WITH_TRANSFER',
      'video',
      "The video's Dolby Vision data disagrees with its HDR format.",
    ],
    [
      'DOLBY_VISION_RPU_STARTS_SAMPLE',
      'video',
      "The video stores its Dolby Vision data in a way that can't be copied.",
    ],
    [
      'H264_NOT_8_BIT_4_2_0',
      'video',
      "The video is H.264 in a bit depth or color format that this device can't play.",
    ],
    [
      'SAMPLE_ENTRY_NOT_COPYABLE',
      'video',
      "The file packages its HEVC video in a way that can't be copied for this player, so the server re-encodes it.",
    ],
    ['VIDEO_CODEC_PROFILE_UNKNOWN', 'video', "The server couldn't name the video's codec profile."],
    [
      'VIDEO_SOURCE_NOT_COPYABLE',
      'video',
      "The server couldn't read this video's picture details, so it encodes it.",
    ],
    [
      'KEYFRAMES_UNKNOWN',
      'video',
      "The server hasn't finished finding this video's keyframes, so it encodes it for now.",
    ],
    ['KEYFRAMES_TOO_SPARSE', 'video', "The video's keyframes are too far apart to copy."],
    ['KEYFRAME_TIMESTAMPS_INVALID', 'video', "The video's keyframe times are out of order."],
    [
      'NO_WORKER_DELIVERS_COPY',
      'video',
      'No connected transcoder can rewrite this video for copying, so the server encodes it.',
    ],
    ['AUDIO_CODEC_NOT_DECLARED', 'audio', "This device can't play TrueHD audio."],
    ['AUDIO_CHANNELS_NOT_DECLARED', 'audio', "This device can't play 7.1 audio."],
    [
      'AUDIO_SOURCE_NOT_COPYABLE',
      'audio',
      "The audio is TrueHD in a profile that can't be copied.",
    ],
    [
      'AUDIO_LOWERED_FOR_BITRATE_LIMIT',
      'audio',
      'You chose 1080p, so the server lowers the audio to 640 kb/s to fit.',
    ],
    [
      'DIRECT_PLAY_FAILED',
      'stream',
      'Direct play failed, so the server streams the video instead.',
    ],
    ['COPY_FAILED', 'stream', 'The copy failed, so the server encodes the video instead.'],
    [
      'ENCODE_FAILED',
      'stream',
      'The encode failed, so the server encodes the video in another codec.',
    ],
  ])('shouldPlaceAndNameTheReasonWhenTheServerNames(%s)', (reason, track, sentence) => {
    expect(reasonsOf([reason])).toEqual({ stream: [], video: [], audio: [], [track]: [sentence] })
  })

  it('shouldNameTheChosenSizeFromTheOutputWhenTheChoiceNamesNoSize', () => {
    expect(reasonsOf(['PICTURE_ABOVE_VIEWER_LIMIT'], { requestedChoice: 'AUTO' }).video).toEqual([
      'You chose Auto, so the server scales this 3840×2160 video down to 1920×1080.',
    ])
  })

  it('shouldLeaveOutAFigureTheProbeDidNotFindWhenAReasonNamesIt', () => {
    const { video } = ENCODED_FOR_1080P
    const decision = {
      ...ENCODED_FOR_1080P,
      video: { ...video, source: { ...video.source, frameRate: null, bitrate: null } },
      audio: { ...TRUEHD_AS_EAC3, output: { ...TRUEHD_AS_EAC3.output, bitrate: null } },
    }

    expect(
      reasonsOf(
        [
          'VIDEO_FRAME_RATE_NOT_DECLARED',
          'BITRATE_ABOVE_VIEWER_LIMIT',
          'AUDIO_LOWERED_FOR_BITRATE_LIMIT',
        ],
        { decision },
      ),
    ).toEqual({
      stream: [],
      video: [
        "This device can't play the video's frame rate.",
        'You chose 1080p, so the server re-encodes this video to fit.',
      ],
      audio: ['You chose 1080p, so the server lowers the audio to fit.'],
    })
  })

  it('shouldNameTheDolbyVisionConversionWhenTheOutputKeepsDolbyVision', () => {
    const { video } = ENCODED_FOR_1080P
    const decision = {
      ...ENCODED_FOR_1080P,
      video: { ...video, output: { ...video.output, dolbyVision: true } },
    }

    expect(reasonsOf(['DOLBY_VISION_NOT_DECLARED'], { decision }).video).toEqual([
      "This device can't play the video's Dolby Vision profile, so the server sends another Dolby Vision profile.",
    ])
  })

  it('shouldNameOnlyTheProfileWhenTheBitDepthBelongsToIt', () => {
    expect(
      reasonsOf(['VIDEO_CODEC_PROFILE_NOT_DECLARED', 'VIDEO_BIT_DEPTH_NOT_DECLARED']).video,
    ).toEqual(["This device plays HEVC, but not the video's profile."])
  })

  it('shouldNameAReasonThisAppDoesNotKnowOnTheStreamLineWhenTheServerAddsOne', () => {
    expect(reasonsOf(['A_REASON_ADDED_LATER' as DecisionReason]).stream).toEqual([
      "The server gave a reason that's new to this app.",
    ])
  })

  it('shouldPlaceTheVideoReasonsAndLeaveOutAnAudioReasonWhenTheDecisionHasNoAudio', () => {
    const decision = { ...ENCODED_FOR_1080P, audio: null }

    expect(
      reasonsOf(['VIDEO_CODEC_NOT_DECLARED', 'AUDIO_CODEC_NOT_DECLARED'], { decision }),
    ).toEqual({
      stream: [],
      video: ["This device can't play the video's codec (HEVC)."],
      audio: [],
    })
  })

  it('shouldMarkTheRowsAnEncodeChangesWhenItBuildsTheVideoTable', () => {
    expect(videoRows(ENCODED_FOR_1080P.video)).toEqual([
      { name: 'Codec', original: 'HEVC', playing: 'HEVC', changed: false },
      { name: 'HDR', original: 'Dolby Vision', playing: 'HDR10', changed: true },
      { name: 'Resolution', original: '3840×2160', playing: '1920×1080', changed: true },
      { name: 'Frame rate', original: '23.976', playing: '23.976', changed: false },
      { name: 'Bitrate', original: '61.2 Mb/s', playing: '38.4 Mb/s', changed: true },
    ])
  })

  it('shouldSayUnknownForAFigureTheProbeDidNotFindWhenItBuildsTheVideoTable', () => {
    const format = { ...ENCODED_FOR_1080P.video.output, frameRate: null, bitrate: null }

    expect(videoRows({ delivery: 'COPY', source: format, output: format })).toEqual([
      { name: 'Codec', original: 'HEVC', playing: 'HEVC', changed: false },
      { name: 'HDR', original: 'HDR10', playing: 'HDR10', changed: false },
      { name: 'Resolution', original: '1920×1080', playing: '1920×1080', changed: false },
      { name: 'Frame rate', original: 'Unknown', playing: 'Unknown', changed: false },
      { name: 'Bitrate', original: 'Unknown', playing: 'Unknown', changed: false },
    ])
  })

  it('shouldShowARangeAndACodecThisAppHasNoNameForAsTheServerNamesThem', () => {
    const format = {
      ...ENCODED_FOR_1080P.video.output,
      codec: 'vvc',
      videoRange: 'A_RANGE_ADDED_LATER' as VideoRange,
    }
    const added = 'A_RANGE_ADDED_LATER'

    expect(videoRows({ delivery: 'COPY', source: format, output: format }).slice(0, 2)).toEqual([
      { name: 'Codec', original: 'vvc', playing: 'vvc', changed: false },
      { name: 'HDR', original: added, playing: added, changed: false },
    ])
  })

  it.each<[number, string]>([
    [1, 'Mono'],
    [2, 'Stereo'],
    [6, '5.1'],
    [8, '7.1'],
    [3, '3 channels'],
  ])('shouldNameTheChannelsWhenTheAudioHas(%i)', (channels, named) => {
    const format = { codec: 'flac', channels, bitrate: null }

    expect(audioRows({ delivery: 'COPY', source: format, output: format })).toEqual([
      { name: 'Codec', original: 'FLAC', playing: 'FLAC', changed: false },
      { name: 'Channels', original: named, playing: named, changed: false },
      { name: 'Bitrate', original: 'Unknown', playing: 'Unknown', changed: false },
    ])
  })

  it('shouldMarkTheRowsAnEncodeChangesWhenItBuildsTheAudioTable', () => {
    expect(audioRows(TRUEHD_AS_EAC3)).toEqual([
      { name: 'Codec', original: 'TrueHD', playing: 'E-AC-3', changed: true },
      { name: 'Channels', original: '7.1', playing: '5.1', changed: true },
      { name: 'Bitrate', original: '4.6 Mb/s', playing: '640 kb/s', changed: true },
    ])
  })

  it('shouldNameADeliveryThisAppDoesNotKnowWhenTheServerAddsOne', () => {
    expect(deliveryText('A_DELIVERY_ADDED_LATER' as PlaybackDelivery)).toBe('Another delivery')
  })
})
