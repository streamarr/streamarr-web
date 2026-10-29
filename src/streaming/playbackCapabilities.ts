import Hls from 'hls.js'
import type {
  AudioCapabilityEntryInput,
  AudioCodec,
  ClientCapabilityDeclarationInput,
  VideoCapabilityEntryInput,
  VideoCodecFamily,
  VideoCodecProfile,
  VideoCodecProfileCapabilityInput,
  VideoCodecTier,
} from '../graphql/generated/graphql'

/** Whether the browser decodes a configuration, and whether it keeps up with its frame rate. */
export interface DecodingAnswer {
  supported: boolean
  smooth: boolean
}

/** The browser facts a capability declaration is built from. */
export interface PlaybackPlatform {
  /** `MediaCapabilities.decodingInfo`, absent where the browser lacks the API. */
  decodingInfo?: (configuration: MediaDecodingConfiguration) => Promise<DecodingAnswer>
  /** Whether hls.js plays here, on Media Source Extensions or ManagedMediaSource. */
  hlsJsSupported: boolean
  /** Whether the media element plays HLS itself. */
  nativeHlsSupported: boolean
  /** `isTypeSupported` of the MediaSource that hls.js plays through. */
  mediaSourceTypeSupported: (type: string) => boolean
  /** `canPlayType` of the media element. */
  canPlayType: (type: string) => CanPlayTypeResult
  userAgent: string
}

// The declaration only gates the start of playback, so a browser that never answers gets the
// minimal declaration rather than a player that never starts.
const DECODING_INFO_TIMEOUT_MS = 3_000

type FamilyLevels = Record<'H264' | 'HEVC' | 'AV1', number>

interface PictureTier {
  width: number
  height: number
  frameRate: number
  bitrate: number
  levels: FamilyLevels
}

// Each level is the lowest that holds the tier's picture size and frame rate.
const UHD_AT_60: PictureTier = {
  width: 3840,
  height: 2160,
  frameRate: 60,
  bitrate: 40_000_000,
  levels: { H264: 52, HEVC: 51, AV1: 51 },
}
const UHD_AT_30: PictureTier = {
  width: 3840,
  height: 2160,
  frameRate: 30,
  bitrate: 40_000_000,
  levels: { H264: 51, HEVC: 50, AV1: 50 },
}
const FULL_HD_AT_60: PictureTier = {
  width: 1920,
  height: 1080,
  frameRate: 60,
  bitrate: 10_000_000,
  levels: { H264: 42, HEVC: 41, AV1: 41 },
}
const FULL_HD_AT_30: PictureTier = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  bitrate: 10_000_000,
  levels: { H264: 40, HEVC: 40, AV1: 40 },
}
// Top down.
const PICTURE_TIERS: readonly PictureTier[] = [UHD_AT_60, UHD_AT_30, FULL_HD_AT_60, FULL_HD_AT_30]

interface BitDepthProbe {
  bitDepth: number
  profiles: readonly VideoCodecProfile[]
  codec: (level: number) => string
}

interface VideoFamily {
  family: keyof FamilyLevels & VideoCodecFamily
  maxTier?: VideoCodecTier
  eightBit: BitDepthProbe
  tenBit?: BitDepthProbe
}

// A High decoder also decodes Main and Constrained Baseline streams; Baseline's extra tools are not.
const H264: VideoFamily = {
  family: 'H264',
  eightBit: {
    bitDepth: 8,
    profiles: ['H264_HIGH', 'H264_MAIN', 'H264_CONSTRAINED_BASELINE'],
    codec: (level) => `avc1.6400${level.toString(16).toUpperCase().padStart(2, '0')}`,
  },
}

const HEVC: VideoFamily = {
  family: 'HEVC',
  maxTier: 'MAIN',
  eightBit: { bitDepth: 8, profiles: ['HEVC_MAIN'], codec: (level) => `hvc1.1.6.L${level * 3}.B0` },
  tenBit: {
    bitDepth: 10,
    profiles: ['HEVC_MAIN_10'],
    codec: (level) => `hvc1.2.4.L${level * 3}.B0`,
  },
}

const AV1: VideoFamily = {
  family: 'AV1',
  maxTier: 'MAIN',
  eightBit: { bitDepth: 8, profiles: ['AV1_MAIN'], codec: (level) => av1Codec(level, '08') },
  tenBit: { bitDepth: 10, profiles: [], codec: (level) => av1Codec(level, '10') },
}

const VIDEO_FAMILIES = [H264, HEVC, AV1]

// AV1 numbers its levels by seq_level_idx: level 2.0 is 0, and each major level has four minors.
function av1Codec(level: number, bitDepth: string): string {
  const index = (Math.floor(level / 10) - 2) * 4 + (level % 10)
  return `av01.0.${index.toString().padStart(2, '0')}M.${bitDepth}`
}

const AUDIO_CODECS: readonly { codec: AudioCodec; mimeCodec: string }[] = [
  { codec: 'AAC', mimeCodec: 'mp4a.40.2' },
  { codec: 'AC3', mimeCodec: 'ac-3' },
  { codec: 'EAC3', mimeCodec: 'ec-3' },
  { codec: 'OPUS', mimeCodec: 'opus' },
  { codec: 'FLAC', mimeCodec: 'flac' },
  { codec: 'ALAC', mimeCodec: 'alac' },
]

// The ladder stops at 5.1: Firefox stays at 6 channels until a 7.1 channel-order test passes, and
// nobody has measured whether decodingInfo honors channel counts (streamarr-web#29).
const CHANNEL_LADDER = [6, 2]
const STEREO = 2

interface DecodedTier {
  tier: PictureTier
  bitDepth: number
  profiles: VideoCodecProfile[]
}

interface TierAnswers {
  tier: PictureTier
  eightBit: DecodingAnswer
  tenBit: DecodingAnswer | null
}

type Ask = (configuration: Omit<MediaDecodingConfiguration, 'type'>) => Promise<DecodingAnswer>

/**
 * What this browser plays over HLS, built fresh for each playback session from the platform's
 * answers. Never rejects: a browser that cannot answer gets the minimal declaration.
 */
export async function declarePlaybackCapabilities(
  platform: PlaybackPlatform,
): Promise<ClientCapabilityDeclarationInput> {
  const hls = platform.hlsJsSupported || platform.nativeHlsSupported
  const minimal = minimalDeclaration(hls)
  const { decodingInfo } = platform
  if (!decodingInfo) {
    return minimal
  }
  let type: MediaDecodingType = 'file'
  if (platform.hlsJsSupported) {
    type = 'media-source'
  }
  const ask: Ask = (configuration) => decodingInfo({ type, ...configuration })
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<ClientCapabilityDeclarationInput>((resolve) => {
    timer = setTimeout(() => resolve(minimal), DECODING_INFO_TIMEOUT_MS)
  })
  try {
    return await Promise.race([probeDeclaration({ platform, ask, hls }), deadline])
  } catch {
    return minimal
  } finally {
    clearTimeout(timer)
  }
}

async function probeDeclaration({
  platform,
  ask,
  hls,
}: {
  platform: PlaybackPlatform
  ask: Ask
  hls: boolean
}): Promise<ClientCapabilityDeclarationInput> {
  const [video, audio] = await Promise.all([
    Promise.all(VIDEO_FAMILIES.map((family) => probeFamily({ platform, family, ask, hls }))),
    Promise.all(AUDIO_CODECS.map(({ codec, mimeCodec }) => probeAudio({ codec, mimeCodec, ask }))),
  ])
  return {
    video: video.flat(),
    audio: audioEntries({ answers: audio, userAgent: platform.userAgent, hls }),
  }
}

async function probeFamily({
  platform,
  family,
  ask,
  hls,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  ask: Ask
  hls: boolean
}): Promise<VideoCapabilityEntryInput[]> {
  const answers = await Promise.all(PICTURE_TIERS.map((tier) => probeTier({ family, tier, ask })))
  let tiers = widestTiers(answers.flatMap((answer) => smoothTier({ family, answer })))
  if (tiers.length === 0) {
    tiers = tiersWithoutSmoothAnswer({ platform, family, answers })
  }
  return tiers.map((decodedTier) => videoEntry({ family, decodedTier, hls }))
}

async function probeTier({
  family,
  tier,
  ask,
}: {
  family: VideoFamily
  tier: PictureTier
  ask: Ask
}): Promise<TierAnswers> {
  const level = tier.levels[family.family]
  const [eightBit, tenBit] = await Promise.all([
    ask(videoConfiguration(tier, family.eightBit.codec(level))),
    family.tenBit ? ask(videoConfiguration(tier, family.tenBit.codec(level))) : null,
  ])
  return { tier, eightBit, tenBit }
}

// A tier that decodes only with dropped frames stutters without a playback error, so no format
// attempt recovers from it: only smooth answers raise a limit.
function smoothTier({
  family,
  answer,
}: {
  family: VideoFamily
  answer: TierAnswers
}): DecodedTier[] {
  if (!isSmooth(answer.eightBit)) {
    return []
  }
  const decoded = eightBitTier(family, answer.tier)
  if (family.tenBit && answer.tenBit && isSmooth(answer.tenBit)) {
    decoded.bitDepth = family.tenBit.bitDepth
    decoded.profiles.push(...family.tenBit.profiles)
  }
  return [decoded]
}

function isSmooth(answer: DecodingAnswer): boolean {
  return answer.supported && answer.smooth
}

// H.264 is the server's encode, so it keeps its lowest decoded tier even without a smooth answer.
// AV1 keeps its lowest tier only when the browser refused every tier and the playing path
// corroborates it; a supported but unsmooth answer is not under-reporting.
function tiersWithoutSmoothAnswer({
  platform,
  family,
  answers,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  answers: readonly TierAnswers[]
}): DecodedTier[] {
  const decoded = answers.filter((answer) => answer.eightBit.supported)
  if (family === H264 && decoded.length > 0) {
    return [eightBitTier(H264, decoded[decoded.length - 1].tier)]
  }
  if (family === AV1 && decoded.length === 0 && isAv1Corroborated(platform)) {
    return [eightBitTier(AV1, FULL_HD_AT_30)]
  }
  return []
}

function eightBitTier(family: VideoFamily, tier: PictureTier): DecodedTier {
  return { tier, bitDepth: family.eightBit.bitDepth, profiles: [...family.eightBit.profiles] }
}

function videoConfiguration(
  tier: PictureTier,
  codec: string,
): Omit<MediaDecodingConfiguration, 'type'> {
  return {
    video: {
      contentType: `video/mp4; codecs="${codec}"`,
      width: tier.width,
      height: tier.height,
      framerate: tier.frameRate,
      bitrate: tier.bitrate,
    },
  }
}

// Keeps a tier only when no wider tier already accepts everything it does, so 2160p30 and 1080p60
// stay separate entries while 1080p30 folds into either.
function widestTiers(decoded: readonly DecodedTier[]): DecodedTier[] {
  const kept: DecodedTier[] = []
  for (const candidate of decoded) {
    if (!kept.some((wider) => isCoveredBy(candidate, wider))) {
      kept.push(candidate)
    }
  }
  return kept
}

function isCoveredBy(candidate: DecodedTier, wider: DecodedTier): boolean {
  return (
    wider.tier.width >= candidate.tier.width &&
    wider.tier.height >= candidate.tier.height &&
    wider.tier.frameRate >= candidate.tier.frameRate &&
    wider.bitDepth >= candidate.bitDepth &&
    candidate.profiles.every((profile) => wider.profiles.includes(profile))
  )
}

// WebKit's decodingInfo under-reports AV1 (streamarr-server#395), so a false answer drops AV1 only
// when the path that plays the stream also refuses its codec string.
function isAv1Corroborated(platform: PlaybackPlatform): boolean {
  const type = `video/mp4; codecs="${AV1.eightBit.codec(FULL_HD_AT_30.levels.AV1)}"`
  if (platform.hlsJsSupported) {
    return platform.mediaSourceTypeSupported(type)
  }
  return platform.canPlayType(type) === 'probably'
}

function videoEntry({
  family,
  decodedTier,
  hls,
}: {
  family: VideoFamily
  decodedTier: DecodedTier
  hls: boolean
}): VideoCapabilityEntryInput {
  const { tier, bitDepth, profiles } = decodedTier
  const maxLevel = tier.levels[family.family]
  return {
    codecFamily: family.family,
    codecProfiles: profiles.map((profile) => codecProfile({ profile, maxLevel, family })),
    maxBitDepth: bitDepth,
    maxWidth: tier.width,
    maxHeight: tier.height,
    maxFrameRate: tier.frameRate,
    compatibleBases: ['SDR'],
    dolbyVisionProfiles: [],
    hdr10Plus: false,
    hls,
  }
}

function codecProfile({
  profile,
  maxLevel,
  family,
}: {
  profile: VideoCodecProfile
  maxLevel: number
  family: VideoFamily
}): VideoCodecProfileCapabilityInput {
  const capability: VideoCodecProfileCapabilityInput = { profile, maxLevel }
  if (family.maxTier) {
    capability.maxTier = family.maxTier
  }
  return capability
}

async function probeAudio({
  codec,
  mimeCodec,
  ask,
}: {
  codec: AudioCodec
  mimeCodec: string
  ask: Ask
}): Promise<{ codec: AudioCodec; maxChannels: number | null }> {
  for (const channels of CHANNEL_LADDER) {
    const { supported } = await ask({
      audio: {
        contentType: `audio/mp4; codecs="${mimeCodec}"`,
        channels: String(channels),
        bitrate: 384_000,
        samplerate: 48_000,
      },
    })
    if (supported) {
      return { codec, maxChannels: channels }
    }
  }
  return { codec, maxChannels: null }
}

function audioEntries({
  answers,
  userAgent,
  hls,
}: {
  answers: readonly { codec: AudioCodec; maxChannels: number | null }[]
  userAgent: string
  hls: boolean
}): AudioCapabilityEntryInput[] {
  const entries: AudioCapabilityEntryInput[] = []
  for (const { codec, maxChannels } of answers) {
    if (codec === 'AAC') {
      // The server's audio encode is AAC, so every declaration carries an HLS AAC entry.
      entries.push({ codec, maxChannels: maxChannels ?? STEREO, hls: true })
      continue
    }
    if (maxChannels === null) {
      continue
    }
    entries.push({ codec, maxChannels: channelCap({ codec, maxChannels, userAgent }), hls })
  }
  return entries
}

// Measured: 5.1 Opus fails in WebKit's native player and in hls.js on WebKit.
function channelCap({
  codec,
  maxChannels,
  userAgent,
}: {
  codec: AudioCodec
  maxChannels: number
  userAgent: string
}): number {
  if (codec === 'OPUS' && isWebKit(userAgent)) {
    return Math.min(maxChannels, STEREO)
  }
  return maxChannels
}

// Every iPhone browser is WebKit; Blink keeps AppleWebKit in its user agent beside Chrome/.
function isWebKit(userAgent: string): boolean {
  return /AppleWebKit\//.test(userAgent) && !/\b(?:Chrome|Chromium)\//.test(userAgent)
}

function minimalDeclaration(hls: boolean): ClientCapabilityDeclarationInput {
  return {
    video: [
      videoEntry({
        family: H264,
        decodedTier: eightBitTier(H264, FULL_HD_AT_30),
        hls,
      }),
    ],
    audio: [{ codec: 'AAC', maxChannels: STEREO, hls: true }],
  }
}

type MediaSourceType = { isTypeSupported: (type: string) => boolean } | undefined

/** Binds the platform facts to this browser and the element that plays the stream. */
export function browserPlaybackPlatform(video: HTMLVideoElement): PlaybackPlatform {
  // hls.js prefers ManagedMediaSource, which TypeScript's DOM library does not declare yet.
  const scope: { ManagedMediaSource?: MediaSourceType; MediaSource?: MediaSourceType } = globalThis
  const mediaSource = scope.ManagedMediaSource ?? scope.MediaSource
  const platform: PlaybackPlatform = {
    hlsJsSupported: Hls.isSupported(),
    nativeHlsSupported: video.canPlayType('application/vnd.apple.mpegurl') !== '',
    mediaSourceTypeSupported: (type) => mediaSource?.isTypeSupported(type) ?? false,
    canPlayType: (type) => video.canPlayType(type),
    userAgent: navigator.userAgent,
  }
  if ('mediaCapabilities' in navigator) {
    platform.decodingInfo = (configuration) =>
      navigator.mediaCapabilities.decodingInfo(configuration)
  }
  return platform
}
