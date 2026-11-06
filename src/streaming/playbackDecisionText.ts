import type {
  AudioFormatFieldsFragment,
  DecisionReason,
  PlaybackDecisionFieldsFragment,
  PlaybackDelivery,
  VideoFormatFieldsFragment,
  VideoQuality,
  VideoRange,
} from '../graphql/generated/graphql'
import { qualityLabel } from './qualityChoices'

type Known<Value extends string> = Exclude<Value, '%future added value'>

type VideoDelivery = PlaybackDecisionFieldsFragment['video']
type AudioDelivery = NonNullable<PlaybackDecisionFieldsFragment['audio']>

/** Where the panel places a reason: on the line under its title, or under the track it changed. */
export type ReasonPlace = 'stream' | 'video' | 'audio'

export type PlacedReasons = Record<ReasonPlace, string[]>

/** One row of a track's table: a figure of the source, and of the output that plays. */
export interface TrackRow {
  name: string
  original: string
  playing: string
  changed: boolean
}

/**
 * What a reason sentence names: the decision's tracks, and the playback choice the viewer asked for,
 * null for a reader who isn't the viewer and doesn't know it.
 */
interface ReasonFacts {
  video: VideoDelivery
  choice: VideoQuality | null
}

type AudioReasonFacts = ReasonFacts & { audio: AudioDelivery }

type Reason =
  | { place: 'stream'; text: string }
  | { place: 'video'; text: (facts: ReasonFacts) => string }
  | { place: 'audio'; text: (facts: AudioReasonFacts) => string }

export const UNKNOWN = 'Unknown'

const DELIVERIES: Record<Known<PlaybackDelivery>, string> = {
  DIRECT_PLAY: 'Direct play',
  COPY: 'Copy',
  ENCODE: 'Encode',
}

const VIDEO_RANGES: Record<Known<VideoRange>, string> = { SDR: 'SDR', PQ: 'HDR10', HLG: 'HLG' }

// The layouts that a channel count usually carries; the server sends only the count.
const CHANNEL_LAYOUTS = new Map([
  [1, 'mono'],
  [2, 'stereo'],
  [6, '5.1'],
  [8, '7.1'],
])

/*
 * Each reason's sentence from streamarr/streamarr-ux#21. A reason about a value that the schema does
 * not send, such as a codec profile, bit depth or channel layout, names the property instead.
 */
const REASONS: Record<Known<DecisionReason>, Reason> = {
  VIDEO_CODEC_NOT_DECLARED: video(
    ({ video }) => `This device can't play the video's codec (${codecText(video.source.codec)}).`,
  ),
  VIDEO_CODEC_PROFILE_NOT_DECLARED: video(
    ({ video }) =>
      `This device plays ${codecText(video.source.codec)}, but not this video's profile.`,
  ),
  VIDEO_CODEC_LEVEL_NOT_DECLARED: video(
    ({ video }) =>
      `This device plays ${codecText(video.source.codec)}, but not this video's level or tier.`,
  ),
  VIDEO_BIT_DEPTH_NOT_DECLARED: video(() => "This device can't play this video's bit depth."),
  VIDEO_BIT_DEPTH_UNKNOWN: video(
    () => "The server couldn't read this video's bit depth, so it encodes it.",
  ),
  VIDEO_PICTURE_SIZE_NOT_DECLARED: video(() => "This device can't play this video's picture size."),
  VIDEO_FRAME_RATE_NOT_DECLARED: video(({ video }) =>
    video.source.frameRate === null
      ? "This device can't play this video's frame rate."
      : `This device can't play ${frameRateText(video.source.frameRate)} fps video.`,
  ),
  DYNAMIC_RANGE_NOT_DECLARED: video(
    ({ video }) =>
      `This device can't show ${videoRangeText(video.source.videoRange)}, so the server converts it.`,
  ),
  VIEWER_CHOSE_SDR: video(
    ({ video }) =>
      `You chose SDR, so the server converts this ${videoRangeText(video.source.videoRange)} video to SDR.`,
  ),
  DOLBY_VISION_NOT_DECLARED: video(
    ({ video }) =>
      `This device can't play this video's Dolby Vision profile or level, so the server sends ${sentHdrText(video)}.`,
  ),
  DOLBY_VISION_PROFILE_OR_LEVEL_UNKNOWN: video(
    ({ video }) =>
      `The server couldn't read this video's Dolby Vision profile or level, so it sends ${sentHdrText(video)}.`,
  ),
  HDR10_PLUS_NOT_DECLARED: video(() => "This device can't play HDR10+."),
  HDR10_PLUS_STRIPPED_BESIDE_DOLBY_VISION: video(
    () => 'The server keeps Dolby Vision in the stream, so it leaves out HDR10+.',
  ),
  PICTURE_ABOVE_VIEWER_LIMIT: video(
    ({ video, choice }) =>
      `${chosenText(choice)}, so the server scales this ${pictureSizeText(video.source)} video down to ${video.output.height}p.`,
  ),
  BITRATE_ABOVE_VIEWER_LIMIT: video(({ video, choice }) => {
    const { bitrate } = video.source
    const source = bitrate === null ? 'this video' : `this ${bitrateText(bitrate)} video`
    return `${chosenText(choice)}, so the server re-encodes ${source} to fit ${chooserText(choice)} choice.`
  }),
  SOURCE_INTERLACED: video(() => 'The video is interlaced, and streaming needs progressive video.'),
  VIDEO_PROPERTIES_NOT_PROBED: video(
    () =>
      'An older server version read this video, so the server encodes it until it reads it again.',
  ),
  DOLBY_VISION_COMPATIBILITY_DISAGREES_WITH_TRANSFER: video(
    () => "The video's Dolby Vision data disagrees with its HDR format.",
  ),
  DOLBY_VISION_RPU_STARTS_SAMPLE: video(
    () => "The video stores its Dolby Vision data in a way that can't be copied into the stream.",
  ),
  H264_NOT_8_BIT_4_2_0: video(
    () =>
      "The server can't copy H.264 in this video's bit depth or color format into the stream, so it encodes the video.",
  ),
  VIDEO_CHROMA_SUBSAMPLING_UNKNOWN: video(
    () => "The server couldn't read this video's color format, so it encodes it.",
  ),
  SAMPLE_ENTRY_NOT_COPYABLE: video(
    ({ video }) =>
      `The file packages its ${codecText(video.source.codec)} video in a sample entry that can't be copied into the stream, so the server re-encodes it.`,
  ),
  VIDEO_CODEC_STRING_UNKNOWN: video(
    () =>
      "The server couldn't read the codec details it needs to copy this video, so it encodes it.",
  ),
  VIDEO_CODEC_PROFILE_UNKNOWN: video(() => "The server couldn't name the video's codec profile."),
  VIDEO_CODEC_UNKNOWN: video(
    () => "The server couldn't name this video's codec, so it encodes it.",
  ),
  VIDEO_SOURCE_NOT_COPYABLE: video(
    () => "The server couldn't read this video's picture details, so it encodes it.",
  ),
  KEYFRAMES_UNKNOWN: video(
    () => "The server doesn't know where this video's keyframes are, so it encodes it.",
  ),
  KEYFRAMES_TOO_SPARSE: video(
    () => 'The keyframes are too far apart to copy this video into the stream.',
  ),
  KEYFRAME_TIMESTAMPS_INVALID: video(
    () => "The video's keyframe times are out of order or out of range.",
  ),
  SEGMENT_EXCEEDS_CAP: video(
    () =>
      'Parts of this video hold too much data to copy into the stream, so the server encodes it.',
  ),
  NO_WORKER_DELIVERS_COPY: video(
    () => 'No connected transcoder can rewrite this video for copying, so the server encodes it.',
  ),
  DIRECT_PLAY_SAMPLE_ENTRY_NOT_DECLARED: video(
    () =>
      "The server couldn't confirm that this device can play this video's sample entry directly.",
  ),
  DIRECT_PLAY_VIDEO_NOT_DECLARED: video(
    () => "The server couldn't confirm that this device can play this file's video directly.",
  ),
  AUDIO_CODEC_NOT_DECLARED: audio(
    ({ audio }) => `This device can't play ${codecText(audio.source.codec)} audio.`,
  ),
  AUDIO_CHANNELS_NOT_DECLARED: audio(() => "This device can't play this audio's channel layout."),
  AUDIO_CHANNELS_UNKNOWN: audio(
    ({ audio }) =>
      `The server couldn't read this audio's channel count, and this device plays ${codecText(audio.source.codec)} only in mono.`,
  ),
  AUDIO_SOURCE_NOT_COPYABLE: audio(() => "This audio's format can't be copied into the stream."),
  AUDIO_CODEC_STRING_UNKNOWN: audio(
    () =>
      "The server couldn't read the codec details it needs to copy this audio, so it encodes it.",
  ),
  AUDIO_BLOCK_SIZE_NOT_DECLARED: audio(
    () => "This device can't play this FLAC audio's block size, so the server encodes the audio.",
  ),
  AUDIO_BLOCK_SIZE_UNKNOWN: audio(
    () =>
      "The server couldn't read this FLAC audio's block size to confirm this device can play it, so it encodes the audio.",
  ),
  AUDIO_LOWERED_FOR_BITRATE_LIMIT: audio(({ audio, choice }) => {
    const { bitrate } = audio.output
    const lowered = bitrate === null ? 'the audio' : `the audio to ${bitrateText(bitrate)}`
    return `${chosenText(choice)}, so the server lowers ${lowered} to fit ${chooserText(choice)} choice.`
  }),
  SOURCE_CONTAINER_UNKNOWN: stream(
    "The server couldn't name this file's container, so it streams the video.",
  ),
  DIRECT_PLAY_CONTAINER_NOT_DECLARED: stream(
    "This device can't play this file directly in its container, so the server streams the video.",
  ),
  // It concerns every audio track of the file, so it shows even when the decision has no audio.
  DIRECT_PLAY_AUDIO_NOT_DECLARED: stream(
    "The server couldn't confirm that this device can play every audio track in this file directly.",
  ),
  DIRECT_PLAY_AUDIO_TRACK_NOT_SELECTABLE: stream(
    "This device can't switch audio tracks inside a file it plays directly, so the server streams the video with the chosen audio track.",
  ),
  FORCED_IMAGE_SUBTITLE_IN_AUDIO_LANGUAGE: stream(
    "This file has forced image subtitles in an audio track's language, so the server streams the video.",
  ),
  DIRECT_PLAY_FAILED: stream('Direct play failed, so the server streams the video instead.'),
  COPY_FAILED: stream('The copy failed, so the server encodes the video instead.'),
  ENCODE_FAILED: stream('The encode failed, so the server encodes the video in another codec.'),
  DOLBY_VISION_COPY_FAILED: stream(
    'The Dolby Vision copy failed, so the server sends the video without Dolby Vision.',
  ),
  HARDWARE_ENCODER_FAILED: stream(
    'The hardware encoder failed, so the server encodes the video in software.',
  ),
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
  // The server sends unknown for a source whose probe named no codec.
  ['unknown', UNKNOWN],
])

const UNKNOWN_DELIVERY = 'Another delivery'
const UNKNOWN_REASON = "The server gave a reason that's new to this app."

const numbers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const frameRates = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

function video(text: (facts: ReasonFacts) => string): Reason {
  return { place: 'video', text }
}

function audio(text: (facts: AudioReasonFacts) => string): Reason {
  return { place: 'audio', text }
}

function stream(text: string): Reason {
  return { place: 'stream', text }
}

function isKnown<Value extends string, Entry>(
  table: Record<Known<Value>, Entry>,
  value: Value,
): value is Known<Value> {
  return Object.hasOwn(table, value)
}

export function deliveryText(delivery: PlaybackDelivery): string {
  return isKnown(DELIVERIES, delivery) ? DELIVERIES[delivery] : UNKNOWN_DELIVERY
}

/** A video range as viewers know it: PQ, which HDR10 and PQ10 share, reads as HDR10. */
export function videoRangeText(range: VideoRange): string {
  return isKnown(VIDEO_RANGES, range) ? VIDEO_RANGES[range] : range
}

/**
 * The sentence for each reason of a decision, placed under the track it changed, or on the stream's
 * line for a failure before this format attempt and a reason this app does not know. A profile that
 * this device does not play also sets the bit depth, so the bit depth's reason is left out beside it.
 */
export function placedReasons({
  decision,
  requestedChoice,
}: Readonly<{
  decision: PlaybackDecisionFieldsFragment
  requestedChoice: VideoQuality | null
}>): PlacedReasons {
  const placed: PlacedReasons = { stream: [], video: [], audio: [] }
  const named = new Set(decision.reasons)
  for (const name of named) {
    if (name === 'VIDEO_BIT_DEPTH_NOT_DECLARED' && named.has('VIDEO_CODEC_PROFILE_NOT_DECLARED')) {
      continue
    }
    const reason: Reason = isKnown(REASONS, name) ? REASONS[name] : stream(UNKNOWN_REASON)
    if (reason.place === 'stream') {
      placed.stream.push(reason.text)
      continue
    }
    const facts = { video: decision.video, choice: requestedChoice }
    if (reason.place === 'video') {
      placed.video.push(reason.text(facts))
      continue
    }
    // The server names an audio reason only for a source with audio.
    if (decision.audio) {
      placed.audio.push(reason.text({ ...facts, audio: decision.audio }))
    }
  }
  return placed
}

export function videoRows({ source, output }: VideoDelivery): TrackRow[] {
  return [
    row('Codec', source, output, (format) => codecText(format.codec)),
    row('HDR', source, output, hdrText),
    row('Resolution', source, output, pictureSizeText),
    row('Frame rate', source, output, ({ frameRate }) =>
      frameRate === null ? UNKNOWN : frameRateText(frameRate),
    ),
    row('Bitrate', source, output, optionalBitrateText),
  ]
}

export function audioRows({ source, output }: AudioDelivery): TrackRow[] {
  return [
    row('Codec', source, output, (format) => codecText(format.codec)),
    row('Channels', source, output, ({ channels }) =>
      channels === null ? UNKNOWN : String(channels),
    ),
    row('Bitrate', source, output, optionalBitrateText),
  ]
}

function row<Format>(
  name: string,
  source: Format,
  output: Format,
  text: (format: Format) => string,
): TrackRow {
  const original = text(source)
  const playing = text(output)
  return { name, original, playing, changed: original !== playing }
}

/** A bitrate in bits per second, such as 8.2 Mb/s or 640 kb/s. */
export function bitrateText(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) {
    return `${numbers.format(bitsPerSecond / 1_000_000)} Mb/s`
  }
  return `${Math.round(bitsPerSecond / 1_000)} kb/s`
}

/** A channel count by its usual layout name, such as stereo or 5.1. */
export function channelsText(channels: number): string {
  return CHANNEL_LAYOUTS.get(channels) ?? `${channels} channels`
}

// The output's HDR as a reason about Dolby Vision names it: a copy that keeps Dolby Vision under
// another profile sends that profile, not the base.
function sentHdrText({ output }: VideoDelivery): string {
  return output.dolbyVision ? 'another Dolby Vision profile' : videoRangeText(output.videoRange)
}

function optionalBitrateText({ bitrate }: { bitrate: number | null }): string {
  return bitrate === null ? UNKNOWN : bitrateText(bitrate)
}

function hdrText(format: VideoFormatFieldsFragment): string {
  return format.dolbyVision ? 'Dolby Vision' : videoRangeText(format.videoRange)
}

function pictureSizeText({ width, height }: VideoFormatFieldsFragment): string {
  return `${width}×${height}`
}

function frameRateText(frameRate: number): string {
  return frameRates.format(frameRate)
}

function chosenText(choice: VideoQuality | null): string {
  if (choice === null) return 'The viewer chose a lower quality'
  return `You chose ${qualityLabel(choice) ?? choice}`
}

function chooserText(choice: VideoQuality | null): string {
  return choice === null ? 'their' : 'your'
}

// The server names codecs in lower case; one this client has no name for shows as sent.
function codecText(codec: AudioFormatFieldsFragment['codec']): string {
  return CODECS.get(codec) ?? codec
}
