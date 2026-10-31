import Hls from 'hls.js'
import type {
  AudioCapabilityEntryInput,
  AudioCodec,
  ClientCapabilityDeclarationInput,
  CreatePlaybackSessionMutation,
  VideoCapabilityEntryInput,
  VideoCodecFamily,
  VideoCodecProfile,
  VideoCodecProfileCapabilityInput,
  VideoCodecTier,
} from '../graphql/generated/graphql'

type CreatePlaybackSessionErrorTypename = NonNullable<
  CreatePlaybackSessionMutation['createPlaybackSession']
>['userErrors'][number]['__typename']

/**
 * The refusals only a defective declaration causes. Their wording names input the viewer never saw,
 * so the player shows its own failure message for them.
 */
export const DECLARATION_REFUSAL_TYPENAMES: ReadonlySet<string> =
  new Set<CreatePlaybackSessionErrorTypename>([
    'CapabilityValuesRequiredError',
    'HlsAacCapabilityRequiredError',
    'CapabilityListTooLongError',
    'CapabilityMaximumInvalidError',
    'CapabilityProfileMismatchError',
    'VideoCodecTierInvalidError',
  ])

/**
 * Whether the browser decodes a configuration, whether it keeps up with its frame rate, and whether
 * it decodes without draining the battery.
 */
export interface DecodingAnswer {
  supported: boolean
  smooth: boolean
  powerEfficient: boolean
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

// The declaration gates the start of playback, so every probe shares one deadline and a probe left
// unanswered at it counts as unconfirmed rather than holding back a player that never starts.
const DECODING_INFO_TIMEOUT_MS = 3_000

type FamilyLevels = Record<'H264' | 'HEVC' | 'AV1', number>

interface PictureTier {
  width: number
  height: number
  frameRate: number
  bitrate: number
  levels: FamilyLevels
}

// Each level is the lowest that holds the tier's picture size and frame rate, and each bitrate
// stays within every family's Main-tier maximum at its level: WebKit refuses an AV1 configuration
// above it.
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
  bitrate: 20_000_000,
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
const HD_AT_30: PictureTier = {
  width: 1280,
  height: 720,
  frameRate: 30,
  bitrate: 5_000_000,
  levels: { H264: 31, HEVC: 31, AV1: 31 },
}
// Sorted widest first: a tier that holds another has the higher pixel rate, so widestTiers meets it
// before the tiers it holds, and the last tier is the lowest.
const PICTURE_TIERS: readonly PictureTier[] = [
  UHD_AT_60,
  UHD_AT_30,
  FULL_HD_AT_60,
  FULL_HD_AT_30,
  HD_AT_30,
].sort((wider, narrower) => pixelRate(narrower) - pixelRate(wider))

function pixelRate(tier: PictureTier): number {
  return tier.width * tier.height * tier.frameRate
}

interface BitDepthProbe {
  bitDepth: number
  profiles: readonly VideoCodecProfile[]
  codec: (level: number) => string
}

interface VideoFamily {
  codecFamily: keyof FamilyLevels & VideoCodecFamily
  maxTier?: VideoCodecTier
  eightBit: BitDepthProbe
  tenBit?: BitDepthProbe
}

// A High decoder also decodes Main and Constrained Baseline streams, not Baseline's extra tools.
const H264: VideoFamily = {
  codecFamily: 'H264',
  eightBit: {
    bitDepth: 8,
    profiles: ['H264_HIGH', 'H264_MAIN', 'H264_CONSTRAINED_BASELINE'],
    codec: (level) => `avc1.6400${level.toString(16).toUpperCase().padStart(2, '0')}`,
  },
}

const HEVC: VideoFamily = {
  codecFamily: 'HEVC',
  maxTier: 'MAIN',
  eightBit: { bitDepth: 8, profiles: ['HEVC_MAIN'], codec: (level) => `hvc1.1.6.L${level * 3}.B0` },
  tenBit: {
    bitDepth: 10,
    profiles: ['HEVC_MAIN_10'],
    codec: (level) => `hvc1.2.4.L${level * 3}.B0`,
  },
}

// AV1 Main covers both bit depths, so a 10-bit maximum also accepts 8-bit (ADR 0049): the 10-bit
// probe names no profile, and a tier declares 10-bit only beside an 8-bit answer that keeps up.
const AV1: VideoFamily = {
  codecFamily: 'AV1',
  maxTier: 'MAIN',
  eightBit: { bitDepth: 8, profiles: ['AV1_MAIN'], codec: (level) => av1Codec(level, 8) },
  tenBit: { bitDepth: 10, profiles: [], codec: (level) => av1Codec(level, 10) },
}

// H.264 is probed beside these: on WebKit, its tiers answered smooth cap power-efficient HEVC.
const VIDEO_FAMILIES_BESIDES_H264 = [HEVC, AV1]

// AV1 numbers its levels by seq_level_idx: level 2.0 is 0, and each major level has four minors.
function av1Codec(level: number, bitDepth: number): string {
  const index = (Math.floor(level / 10) - 2) * 4 + (level % 10)
  return `av01.0.${index.toString().padStart(2, '0')}M.${bitDepth.toString().padStart(2, '0')}`
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

// Null when the browser rejected the probe or left it unanswered at the deadline.
type ProbeAnswer = DecodingAnswer | null

interface TierAnswers {
  tier: PictureTier
  eightBit: ProbeAnswer
  tenBit: ProbeAnswer
}

// maxChannels is null when the browser confirmed no channel count for the codec.
interface AudioAnswer {
  codec: AudioCodec
  maxChannels: number | null
}

type AskDecodingInfo = (
  configuration: Omit<MediaDecodingConfiguration, 'type'>,
) => Promise<ProbeAnswer>

/**
 * What this browser plays over HLS, built fresh for each playback session from the platform's
 * answers. Never rejects: each probe the browser rejects or leaves unanswered counts as
 * unconfirmed, and a browser without decodingInfo gets the minimal declaration.
 */
export async function declarePlaybackCapabilities(
  platform: PlaybackPlatform,
): Promise<ClientCapabilityDeclarationInput> {
  const hls = platform.hlsJsSupported || platform.nativeHlsSupported
  const { decodingInfo } = platform
  if (!decodingInfo) {
    return minimalDeclaration(hls)
  }
  let type: MediaDecodingType = 'file'
  if (platform.hlsJsSupported) {
    type = 'media-source'
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DECODING_INFO_TIMEOUT_MS)
  })
  const askDecodingInfo: AskDecodingInfo = (configuration) => {
    // Called inside the executor so a decodingInfo that throws synchronously becomes a rejection,
    // which settles this probe alone instead of failing every probe in the declaration.
    const answer = new Promise<DecodingAnswer>((resolve) =>
      resolve(decodingInfo({ type, ...configuration })),
    )
    return Promise.race([answer.catch(() => null), deadline])
  }
  try {
    return await probeDeclaration({ platform, askDecodingInfo, hls })
  } finally {
    clearTimeout(timer)
  }
}

async function probeDeclaration({
  platform,
  askDecodingInfo,
  hls,
}: {
  platform: PlaybackPlatform
  askDecodingInfo: AskDecodingInfo
  hls: boolean
}): Promise<ClientCapabilityDeclarationInput> {
  const [video, audio] = await Promise.all([
    probeVideo({ platform, askDecodingInfo, hls }),
    Promise.all(
      AUDIO_CODECS.map(({ codec, mimeCodec }) => probeAudio({ codec, mimeCodec, askDecodingInfo })),
    ),
  ])
  return {
    video,
    audio: audioEntries({ answers: audio, userAgent: platform.userAgent, hls }),
  }
}

async function probeVideo({
  platform,
  askDecodingInfo,
  hls,
}: {
  platform: PlaybackPlatform
  askDecodingInfo: AskDecodingInfo
  hls: boolean
}): Promise<VideoCapabilityEntryInput[]> {
  const [h264Answers, otherFamilies] = await Promise.all([
    probeFamily({ family: H264, askDecodingInfo }),
    Promise.all(
      VIDEO_FAMILIES_BESIDES_H264.map(async (family) => ({
        family,
        answers: await probeFamily({ family, askDecodingInfo }),
      })),
    ),
  ])
  const probed = [{ family: H264, answers: h264Answers }, ...otherFamilies]
  return probed.flatMap(({ family, answers }) =>
    familyEntries({ platform, family, answers, h264Answers, hls }),
  )
}

function probeFamily({
  family,
  askDecodingInfo,
}: {
  family: VideoFamily
  askDecodingInfo: AskDecodingInfo
}): Promise<TierAnswers[]> {
  return Promise.all(PICTURE_TIERS.map((tier) => probeTier({ family, tier, askDecodingInfo })))
}

function familyEntries({
  platform,
  family,
  answers,
  h264Answers,
  hls,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  answers: readonly TierAnswers[]
  h264Answers: readonly TierAnswers[]
  hls: boolean
}): VideoCapabilityEntryInput[] {
  const keepsUp = keepsUpOn({ platform, family, answers, h264Answers })
  let tiers = widestTiers(answers.flatMap((answer) => tierThatKeepsUp({ family, answer, keepsUp })))
  if (tiers.length === 0) {
    tiers = tiersWithoutAnswerThatKeepsUp({ platform, family, answers })
  }
  return tiers.map((decodedTier) => videoEntry({ family, decodedTier, hls }))
}

async function probeTier({
  family,
  tier,
  askDecodingInfo,
}: {
  family: VideoFamily
  tier: PictureTier
  askDecodingInfo: AskDecodingInfo
}): Promise<TierAnswers> {
  const level = tier.levels[family.codecFamily]
  const eightBitAnswer = askDecodingInfo(videoConfiguration(tier, family.eightBit.codec(level)))
  let tenBitAnswer: Promise<ProbeAnswer> = Promise.resolve(null)
  if (family.tenBit) {
    tenBitAnswer = askDecodingInfo(videoConfiguration(tier, family.tenBit.codec(level)))
  }
  const [eightBit, tenBit] = await Promise.all([eightBitAnswer, tenBitAnswer])
  return { tier, eightBit, tenBit }
}

// A tier that decodes only with dropped frames stutters without a playback error, so no format
// attempt recovers from it: only answers that keep up raise a limit. Each bit depth counts on its
// own answer, and the tier holds only the codec profiles of the bit depths that keep up.
function tierThatKeepsUp({
  family,
  answer,
  keepsUp,
}: {
  family: VideoFamily
  answer: TierAnswers
  keepsUp: KeepsUp
}): DecodedTier[] {
  const keptUp: BitDepthProbe[] = []
  if (keepsUp(answer, 'eightBit')) {
    keptUp.push(family.eightBit)
  }
  if (family.tenBit && keepsUp(answer, 'tenBit')) {
    keptUp.push(family.tenBit)
  }
  const profiles = keptUp.flatMap((probe) => probe.profiles)
  if (profiles.length === 0) {
    return []
  }
  const bitDepth = Math.max(...keptUp.map((probe) => probe.bitDepth))
  return [{ tier: answer.tier, bitDepth, profiles }]
}

type BitDepthKey = 'eightBit' | 'tenBit'

type KeepsUp = (answer: TierAnswers, bitDepth: BitDepthKey) => boolean

// Safari on iOS 27.2, on a phone that decodes HEVC in hardware, answers HEVC Main and Main 10
// supported and power-efficient but never smooth, at every tier from 720p30 to 2160p60. On WebKit a
// power-efficient HEVC answer therefore keeps up, but power efficiency says which decoder runs, not
// how fast: a phone that decodes 1080p in hardware may still drop frames at 2160p60. So a
// power-efficient HEVC answer keeps up only up to the highest H.264 tier WebKit answers smooth.
// That cap measures no decode throughput: WebKit's Cocoa decodingInfo answers H.264 smooth once
// the codec string passes its support checks and VideoToolbox is available, whatever the picture
// size or frame rate. The cap therefore holds power-efficient HEVC to the highest H.264
// configuration WebKit accepts. If WebKit answers no H.264 tier smooth, power-efficient HEVC is
// dropped and the server encodes instead. WebKit answers HEVC smooth up to the decoder's maximum
// playback level, so once a profile answers smooth at any tier, its smooth answers are its ceiling
// and power efficiency no longer stands in for them. Elsewhere only a smooth answer keeps up.
function keepsUpOn({
  platform,
  family,
  answers,
  h264Answers,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  answers: readonly TierAnswers[]
  h264Answers: readonly TierAnswers[]
}): KeepsUp {
  if (family !== HEVC || !isWebKit(platform.userAgent)) {
    return (answer, bitDepth) => isSmooth(answer[bitDepth])
  }
  const budget = h264Answers.filter((answer) => isSmooth(answer.eightBit))
  return (answer, bitDepth) => {
    if (isSmooth(answer[bitDepth])) {
      return true
    }
    if (answers.some((other) => isSmooth(other[bitDepth]))) {
      return false
    }
    return (
      isPowerEfficient(answer[bitDepth]) &&
      budget.some((h264) => holdsPicture(h264.tier, answer.tier))
    )
  }
}

function isSmooth(answer: ProbeAnswer): boolean {
  return answer !== null && answer.supported && answer.smooth
}

function isPowerEfficient(answer: ProbeAnswer): boolean {
  return answer !== null && answer.supported && answer.powerEfficient
}

function isRefusal(answer: ProbeAnswer): boolean {
  return answer !== null && !answer.supported
}

// H.264 is the server's encode, so without an answer that keeps up it keeps its lowest tier the
// browser answered supported, and the full HD tier only when no H.264 probe was answered at all.
// AV1 keeps its lowest tier only on WebKit, when every answer was a refusal and the playing path
// corroborates it; a supported but unsmooth answer is not under-reporting, and an unanswered probe
// is not an answer.
function tiersWithoutAnswerThatKeepsUp({
  platform,
  family,
  answers,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  answers: readonly TierAnswers[]
}): DecodedTier[] {
  const answered = answers.filter((answer) => answer.eightBit !== null)
  if (family === H264) {
    return h264TierWithoutAnswerThatKeepsUp(answered)
  }
  const isEveryAnswerARefusal =
    answered.length > 0 && answered.every((answer) => isRefusal(answer.eightBit))
  if (family === AV1 && isEveryAnswerARefusal && isAv1UnderReported(platform)) {
    return [eightBitTier(AV1, FULL_HD_AT_30)]
  }
  return []
}

function h264TierWithoutAnswerThatKeepsUp(answered: readonly TierAnswers[]): DecodedTier[] {
  if (answered.length === 0) {
    return [eightBitTier(H264, FULL_HD_AT_30)]
  }
  const supported = answered.filter((answer) => answer.eightBit?.supported)
  if (supported.length === 0) {
    return []
  }
  // Unanswered lower tiers never raise the fallback above the full HD tier declared without answers.
  let tier = supported[supported.length - 1].tier
  if (!holdsPicture(FULL_HD_AT_30, tier)) {
    tier = FULL_HD_AT_30
  }
  return [eightBitTier(H264, tier)]
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
    holdsPicture(wider.tier, candidate.tier) &&
    wider.bitDepth >= candidate.bitDepth &&
    candidate.profiles.every((profile) => wider.profiles.includes(profile))
  )
}

function holdsPicture(wider: PictureTier, tier: PictureTier): boolean {
  return (
    wider.width >= tier.width && wider.height >= tier.height && wider.frameRate >= tier.frameRate
  )
}

// WebKit's decodingInfo under-reports AV1 (streamarr-server#395), so there a false answer drops AV1
// only when the path that plays the stream also refuses its codec string. Elsewhere it stands.
function isAv1UnderReported(platform: PlaybackPlatform): boolean {
  if (!isWebKit(platform.userAgent)) {
    return false
  }
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
  const maxLevel = tier.levels[family.codecFamily]
  return {
    codecFamily: family.codecFamily,
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
  askDecodingInfo,
}: {
  codec: AudioCodec
  mimeCodec: string
  askDecodingInfo: AskDecodingInfo
}): Promise<AudioAnswer> {
  // Every rung starts at once: a rung asked only after a slow one would race an expired deadline.
  const rungs = CHANNEL_LADDER.map((channels) => ({
    channels,
    answer: askDecodingInfo({
      audio: {
        contentType: `audio/mp4; codecs="${mimeCodec}"`,
        channels: String(channels),
        bitrate: 384_000,
        samplerate: 48_000,
      },
    }),
  }))
  for (const { channels, answer } of rungs) {
    if ((await answer)?.supported) {
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
  answers: readonly AudioAnswer[]
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

interface MediaSourceType {
  isTypeSupported: (type: string) => boolean
}

/** Binds the platform facts to this browser and the element that plays the stream. */
export function browserPlaybackPlatform(video: HTMLVideoElement): PlaybackPlatform {
  // The order hls.js attaches through by default (preferManagedMediaSource: false). TypeScript's
  // DOM library declares neither ManagedMediaSource nor WebKitMediaSource.
  const scope: {
    MediaSource?: MediaSourceType
    ManagedMediaSource?: MediaSourceType
    WebKitMediaSource?: MediaSourceType
  } = globalThis
  const mediaSource = scope.MediaSource ?? scope.ManagedMediaSource ?? scope.WebKitMediaSource
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
