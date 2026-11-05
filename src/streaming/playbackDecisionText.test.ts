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
  // Every DecisionReason in the schema's order, each with its sentence from streamarr/streamarr-ux#21.
  it.each<[DecisionReason, 'video' | 'audio' | 'stream', string]>([
    ['VIDEO_CODEC_NOT_DECLARED', 'video', "This device can't play the video's codec (HEVC)."],
    [
      'VIDEO_CODEC_PROFILE_NOT_DECLARED',
      'video',
      "This device plays HEVC, but not this video's profile.",
    ],
    [
      'VIDEO_CODEC_LEVEL_NOT_DECLARED',
      'video',
      "This device plays HEVC, but not this video's level or tier.",
    ],
    ['VIDEO_BIT_DEPTH_NOT_DECLARED', 'video', "This device can't play this video's bit depth."],
    [
      'VIDEO_BIT_DEPTH_UNKNOWN',
      'video',
      "The server couldn't read this video's bit depth, so it encodes it.",
    ],
    [
      'VIDEO_PICTURE_SIZE_NOT_DECLARED',
      'video',
      "This device can't play this video's picture size.",
    ],
    ['VIDEO_FRAME_RATE_NOT_DECLARED', 'video', "This device can't play 23.976 fps video."],
    [
      'DYNAMIC_RANGE_NOT_DECLARED',
      'video',
      "This device can't show HDR10, so the server converts it.",
    ],
    [
      'DOLBY_VISION_NOT_DECLARED',
      'video',
      "This device can't play this video's Dolby Vision profile or level, so the server sends HDR10.",
    ],
    [
      'DOLBY_VISION_PROFILE_OR_LEVEL_UNKNOWN',
      'video',
      "The server couldn't read this video's Dolby Vision profile or level, so it sends HDR10.",
    ],
    ['HDR10_PLUS_NOT_DECLARED', 'video', "This device can't play HDR10+."],
    [
      'HDR10_PLUS_STRIPPED_BESIDE_DOLBY_VISION',
      'video',
      'The server keeps Dolby Vision in the stream, so it leaves out HDR10+.',
    ],
    [
      'PICTURE_ABOVE_VIEWER_LIMIT',
      'video',
      'You chose 1080p, so the server scales this 3840×2160 video down to 1080p.',
    ],
    [
      'BITRATE_ABOVE_VIEWER_LIMIT',
      'video',
      'You chose 1080p, so the server re-encodes this 61.2 Mb/s video to fit your choice.',
    ],
    [
      'SOURCE_INTERLACED',
      'video',
      'The video is interlaced, and streaming needs progressive video.',
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
      "The video stores its Dolby Vision data in a way that can't be copied into the stream.",
    ],
    [
      'H264_NOT_8_BIT_4_2_0',
      'video',
      "The server can't copy H.264 in this video's bit depth or color format into the stream, so it encodes the video.",
    ],
    [
      'VIDEO_CHROMA_SUBSAMPLING_UNKNOWN',
      'video',
      "The server couldn't read this video's color format, so it encodes it.",
    ],
    [
      'SAMPLE_ENTRY_NOT_COPYABLE',
      'video',
      "The file packages its HEVC video in a sample entry that can't be copied into the stream, so the server re-encodes it.",
    ],
    [
      'VIDEO_CODEC_STRING_UNKNOWN',
      'video',
      "The server couldn't read the codec details it needs to copy this video, so it encodes it.",
    ],
    ['VIDEO_CODEC_PROFILE_UNKNOWN', 'video', "The server couldn't name the video's codec profile."],
    [
      'VIDEO_CODEC_UNKNOWN',
      'video',
      "The server couldn't name this video's codec, so it encodes it.",
    ],
    [
      'VIDEO_SOURCE_NOT_COPYABLE',
      'video',
      "The server couldn't read this video's picture details, so it encodes it.",
    ],
    [
      'KEYFRAMES_UNKNOWN',
      'video',
      "The server doesn't know where this video's keyframes are, so it encodes it.",
    ],
    [
      'KEYFRAMES_TOO_SPARSE',
      'video',
      'The keyframes are too far apart to copy this video into the stream.',
    ],
    [
      'KEYFRAME_TIMESTAMPS_INVALID',
      'video',
      "The video's keyframe times are out of order or out of range.",
    ],
    [
      'SEGMENT_EXCEEDS_CAP',
      'video',
      'Parts of this video hold too much data to copy into the stream, so the server encodes it.',
    ],
    [
      'NO_WORKER_DELIVERS_COPY',
      'video',
      'No connected transcoder can rewrite this video for copying, so the server encodes it.',
    ],
    ['AUDIO_CODEC_NOT_DECLARED', 'audio', "This device can't play TrueHD audio."],
    ['AUDIO_CHANNELS_NOT_DECLARED', 'audio', "This device can't play this audio's channel layout."],
    [
      'AUDIO_CHANNELS_UNKNOWN',
      'audio',
      "The server couldn't read this audio's channel count, and this device plays TrueHD only in mono.",
    ],
    ['AUDIO_SOURCE_NOT_COPYABLE', 'audio', "This audio's format can't be copied into the stream."],
    [
      'AUDIO_CODEC_STRING_UNKNOWN',
      'audio',
      "The server couldn't read the codec details it needs to copy this audio, so it encodes it.",
    ],
    [
      'AUDIO_BLOCK_SIZE_NOT_DECLARED',
      'audio',
      "This device can't play this FLAC audio's block size, so the server encodes the audio.",
    ],
    [
      'AUDIO_BLOCK_SIZE_UNKNOWN',
      'audio',
      "The server couldn't read this FLAC audio's block size to confirm this device can play it, so it encodes the audio.",
    ],
    [
      'AUDIO_LOWERED_FOR_BITRATE_LIMIT',
      'audio',
      'You chose 1080p, so the server lowers the audio to 640 kb/s to fit your choice.',
    ],
    [
      'SOURCE_CONTAINER_UNKNOWN',
      'stream',
      "The server couldn't name this file's container, so it streams the video.",
    ],
    [
      'DIRECT_PLAY_CONTAINER_NOT_DECLARED',
      'stream',
      "This device can't play this file directly in its container, so the server streams the video.",
    ],
    [
      'DIRECT_PLAY_SAMPLE_ENTRY_NOT_DECLARED',
      'video',
      "The server couldn't confirm that this device can play this video's sample entry directly.",
    ],
    [
      'DIRECT_PLAY_VIDEO_NOT_DECLARED',
      'video',
      "The server couldn't confirm that this device can play this file's video directly.",
    ],
    [
      'DIRECT_PLAY_AUDIO_NOT_DECLARED',
      'stream',
      "The server couldn't confirm that this device can play every audio track in this file directly.",
    ],
    [
      'DIRECT_PLAY_AUDIO_TRACK_NOT_SELECTABLE',
      'stream',
      "This device can't switch audio tracks inside a file it plays directly, so the server streams the video with the chosen audio track.",
    ],
    [
      'FORCED_IMAGE_SUBTITLE_IN_AUDIO_LANGUAGE',
      'stream',
      "This file has forced image subtitles in an audio track's language, so the server streams the video.",
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
    [
      'DOLBY_VISION_COPY_FAILED',
      'stream',
      'The Dolby Vision copy failed, so the server sends the video without Dolby Vision.',
    ],
  ])('shouldPlaceAndNameTheReasonWhenTheServerNames(%s)', (reason, track, sentence) => {
    expect(reasonsOf([reason])).toEqual({ stream: [], video: [], audio: [], [track]: [sentence] })
  })

  it('shouldNameTheChosenSizeFromTheOutputWhenTheChoiceNamesNoSize', () => {
    expect(reasonsOf(['PICTURE_ABOVE_VIEWER_LIMIT'], { requestedChoice: 'AUTO' }).video).toEqual([
      'You chose Auto, so the server scales this 3840×2160 video down to 1080p.',
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
        "This device can't play this video's frame rate.",
        'You chose 1080p, so the server re-encodes this video to fit your choice.',
      ],
      audio: ['You chose 1080p, so the server lowers the audio to fit your choice.'],
    })
  })

  it('shouldNameTheDolbyVisionConversionWhenTheOutputKeepsDolbyVision', () => {
    const { video } = ENCODED_FOR_1080P
    const decision = {
      ...ENCODED_FOR_1080P,
      video: { ...video, output: { ...video.output, dolbyVision: true } },
    }

    expect(
      reasonsOf(['DOLBY_VISION_NOT_DECLARED', 'DOLBY_VISION_PROFILE_OR_LEVEL_UNKNOWN'], {
        decision,
      }).video,
    ).toEqual([
      "This device can't play this video's Dolby Vision profile or level, so the server sends another Dolby Vision profile.",
      "The server couldn't read this video's Dolby Vision profile or level, so it sends another Dolby Vision profile.",
    ])
  })

  it('shouldNameTheSourceBaseAloneWhenTheDeviceCannotShowItsRange', () => {
    const { video } = ENCODED_FOR_1080P
    const decision = {
      ...ENCODED_FOR_1080P,
      video: { ...video, source: { ...video.source, videoRange: 'SDR' as const } },
    }

    expect(reasonsOf(['DYNAMIC_RANGE_NOT_DECLARED'], { decision }).video).toEqual([
      "This device can't show SDR, so the server converts it.",
    ])
  })

  it('shouldPutEachReasonAboutTheWholeFileOnTheStreamLineWhenTheServerNamesSeveral', () => {
    expect(
      reasonsOf([
        'DIRECT_PLAY_CONTAINER_NOT_DECLARED',
        'VIDEO_CODEC_NOT_DECLARED',
        'DIRECT_PLAY_AUDIO_NOT_DECLARED',
      ]).stream,
    ).toEqual([
      "This device can't play this file directly in its container, so the server streams the video.",
      "The server couldn't confirm that this device can play every audio track in this file directly.",
    ])
  })

  it('shouldKeepTheReasonAboutEveryAudioTrackWhenTheDecisionHasNoAudio', () => {
    const decision = { ...ENCODED_FOR_1080P, audio: null }

    expect(reasonsOf(['DIRECT_PLAY_AUDIO_NOT_DECLARED'], { decision }).stream).toEqual([
      "The server couldn't confirm that this device can play every audio track in this file directly.",
    ])
  })

  it('shouldNameOnlyTheProfileWhenTheBitDepthBelongsToIt', () => {
    expect(
      reasonsOf(['VIDEO_CODEC_PROFILE_NOT_DECLARED', 'VIDEO_BIT_DEPTH_NOT_DECLARED']).video,
    ).toEqual(["This device plays HEVC, but not this video's profile."])
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

  it.each<[number | null, string]>([
    [2, '2'],
    [6, '6'],
    [null, 'Unknown'],
  ])('shouldShowTheChannelCountTheServerSendsWhenTheAudioHas(%s)', (channels, shown) => {
    const format = { codec: 'flac', channels, bitrate: null }

    expect(audioRows({ delivery: 'COPY', source: format, output: format })).toEqual([
      { name: 'Codec', original: 'FLAC', playing: 'FLAC', changed: false },
      { name: 'Channels', original: shown, playing: shown, changed: false },
      { name: 'Bitrate', original: 'Unknown', playing: 'Unknown', changed: false },
    ])
  })

  it('shouldSayUnknownForACodecTheProbeDidNotNameWhenItBuildsTheTables', () => {
    const video = { ...ENCODED_FOR_1080P.video.source, codec: 'unknown' }
    const audio = { codec: 'unknown', channels: null, bitrate: null }

    expect(videoRows({ delivery: 'ENCODE', source: video, output: video })[0]).toEqual({
      name: 'Codec',
      original: 'Unknown',
      playing: 'Unknown',
      changed: false,
    })
    expect(audioRows({ delivery: 'ENCODE', source: audio, output: audio })[0]).toEqual({
      name: 'Codec',
      original: 'Unknown',
      playing: 'Unknown',
      changed: false,
    })
  })

  it('shouldMarkTheRowsAnEncodeChangesWhenItBuildsTheAudioTable', () => {
    expect(audioRows(TRUEHD_AS_EAC3)).toEqual([
      { name: 'Codec', original: 'TrueHD', playing: 'E-AC-3', changed: true },
      { name: 'Channels', original: '8', playing: '6', changed: true },
      { name: 'Bitrate', original: '4.6 Mb/s', playing: '640 kb/s', changed: true },
    ])
  })

  it('shouldNameADeliveryThisAppDoesNotKnowWhenTheServerAddsOne', () => {
    expect(deliveryText('A_DELIVERY_ADDED_LATER' as PlaybackDelivery)).toBe('Another delivery')
  })
})
