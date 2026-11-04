import type {
  AudioFormatFieldsFragment,
  DecisionReason,
  PlaybackDelivery,
  VideoFormatFieldsFragment,
  VideoRange,
} from '../graphql/generated/graphql'

type Known<Value extends string> = Exclude<Value, '%future added value'>

const DELIVERIES: Record<Known<PlaybackDelivery>, string> = {
  DIRECT_PLAY: 'Direct play',
  COPY: 'Copy',
  ENCODE: 'Encode',
}

const VIDEO_RANGES: Record<Known<VideoRange>, string> = { SDR: 'SDR', PQ: 'PQ', HLG: 'HLG' }

const REASONS: Record<Known<DecisionReason>, string> = {
  VIDEO_CODEC_NOT_DECLARED: 'This device does not declare the video codec.',
  VIDEO_CODEC_PROFILE_NOT_DECLARED: "This device does not declare the video's codec profile.",
  VIDEO_CODEC_LEVEL_NOT_DECLARED: "The video's codec level is above what this device declares.",
  VIDEO_BIT_DEPTH_NOT_DECLARED: "The video's bit depth is above what this device declares.",
  VIDEO_PICTURE_SIZE_NOT_DECLARED: "The video's picture is larger than this device declares.",
  VIDEO_FRAME_RATE_NOT_DECLARED: "The video's frame rate is above what this device declares.",
  DYNAMIC_RANGE_NOT_DECLARED: "This device does not declare the video's HDR format.",
  DOLBY_VISION_NOT_DECLARED: "This device does not declare the video's Dolby Vision profile.",
  HDR10_PLUS_NOT_DECLARED: 'This device does not declare HDR10+.',
  PICTURE_ABOVE_VIEWER_LIMIT: "The video's picture is larger than the chosen quality.",
  BITRATE_ABOVE_VIEWER_LIMIT: "The video's bitrate is above this player's limit.",
  SOURCE_INTERLACED: 'The video is interlaced, and streaming needs progressive video.',
  DOLBY_VISION_WITHOUT_COMPATIBLE_BASE:
    'The video is Dolby Vision without an HDR or SDR picture that other devices show.',
  VIDEO_PROPERTIES_NOT_PROBED: "The server hasn't read all of the video's properties yet.",
  DOLBY_VISION_COMPATIBILITY_DISAGREES_WITH_TRANSFER:
    "The video's Dolby Vision data disagrees with its HDR format.",
  DOLBY_VISION_RPU_STARTS_SAMPLE:
    "The video's Dolby Vision data sits where a copy would misplace it.",
  H264_NOT_8_BIT_4_2_0:
    'The video is H.264 in a bit depth or color format that a copy cannot keep.',
  SAMPLE_ENTRY_NOT_COPYABLE: 'The file labels its video in a way that a copy cannot stream.',
  VIDEO_CODEC_PROFILE_UNKNOWN: "The server couldn't read the video's codec profile.",
  VIDEO_SOURCE_NOT_COPYABLE: "The server doesn't have the video facts that a copy needs.",
  KEYFRAMES_UNKNOWN: "The server hasn't read the video's keyframes yet.",
  KEYFRAMES_TOO_SPARSE: "The video's keyframes are too far apart for a copy.",
  KEYFRAME_TIMESTAMPS_INVALID: "The video's keyframe times are out of order.",
  NO_WORKER_DELIVERS_COPY: 'No connected worker can make the copy.',
  AUDIO_CODEC_NOT_DECLARED: 'This device does not declare the audio codec.',
  AUDIO_CHANNELS_NOT_DECLARED: 'The audio has more channels than this device declares.',
  AUDIO_SOURCE_NOT_COPYABLE: "A copy can't stream the audio's codec profile.",
  AUDIO_LOWERED_FOR_BITRATE_LIMIT:
    "The audio is lowered to stay within this player's bitrate limit.",
  DIRECT_PLAY_FAILED: "The original file didn't play directly, so it streams instead.",
  COPY_FAILED: "The copy didn't play, so the video is converted.",
  ENCODE_FAILED: "The converted video didn't play, so it is converted in another format.",
}

const CODECS = new Map([
  ['h264', 'H.264'],
  ['hevc', 'HEVC'],
  ['av1', 'AV1'],
  ['vp9', 'VP9'],
  ['aac', 'AAC'],
  ['ac3', 'AC-3'],
  ['eac3', 'E-AC-3'],
  ['flac', 'FLAC'],
  ['opus', 'Opus'],
  ['alac', 'ALAC'],
  ['mp3', 'MP3'],
  ['truehd', 'TrueHD'],
  ['dts', 'DTS'],
])

const UNKNOWN_DELIVERY = 'Another delivery'
const UNKNOWN_REASON = 'The server named a reason that this app does not know yet.'

const numbers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const frameRates = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

function isKnown<Value extends string>(
  table: Record<Known<Value>, string>,
  value: Value,
): value is Known<Value> {
  return Object.hasOwn(table, value)
}

export function deliveryText(delivery: PlaybackDelivery): string {
  return isKnown(DELIVERIES, delivery) ? DELIVERIES[delivery] : UNKNOWN_DELIVERY
}

export function reasonText(reason: DecisionReason): string {
  return isKnown(REASONS, reason) ? REASONS[reason] : UNKNOWN_REASON
}

export function videoRangeText(range: VideoRange): string {
  return isKnown(VIDEO_RANGES, range) ? VIDEO_RANGES[range] : range
}

/** A bitrate in bits per second, such as 8.2 Mb/s or 640 kb/s. */
export function bitrateText(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) {
    return `${numbers.format(bitsPerSecond / 1_000_000)} Mb/s`
  }
  return `${Math.round(bitsPerSecond / 1_000)} kb/s`
}

export function channelsText(channels: number): string {
  return channels === 1 ? '1 channel' : `${channels} channels`
}

export function videoFormatText(format: VideoFormatFieldsFragment): string {
  return [
    codecText(format.codec),
    `${format.width}×${format.height}`,
    format.frameRate === null ? null : `${frameRates.format(format.frameRate)} fps`,
    videoRangeText(format.videoRange),
    format.dolbyVision ? 'Dolby Vision' : null,
    format.bitrate === null ? null : bitrateText(format.bitrate),
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

export function audioFormatText(format: AudioFormatFieldsFragment): string {
  return [
    codecText(format.codec),
    channelsText(format.channels),
    format.bitrate === null ? null : bitrateText(format.bitrate),
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

// The server names codecs in lower case; one this client has no name for shows as sent.
function codecText(codec: string): string {
  return CODECS.get(codec) ?? codec
}
