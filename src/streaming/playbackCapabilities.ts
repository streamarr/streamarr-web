import Hls from 'hls.js'
import type {
  AudioCapabilityEntryInput,
  AudioCodec,
  ClientCapabilityDeclarationInput,
  CreatePlaybackSessionMutation,
  DeclaredCompatibleBase,
  DolbyVisionProfile,
  DolbyVisionProfileCapabilityInput,
  SourceContainer,
  VideoCapabilityEntryInput,
  VideoCodecFamily,
  VideoCodecProfile,
  VideoCodecProfileCapabilityInput,
  VideoCodecTier,
  VideoSampleEntry,
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

/** The browser's reported decoding support, frame-rate smoothness, and power efficiency. */
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
  /**
   * The most channels the default audio output plays. Resolves 0 where the browser reports none, and
   * settles only after any AudioContext it opened has closed.
   */
  audioOutputChannels: () => Promise<number>
  /** Whether the display, or the plane that video plays on, shows high dynamic range. */
  displaysHighDynamicRange: boolean
  /** Whether the media element lists a file's audio tracks and switches among them. */
  selectsAudioTrackInDirectPlay: boolean
}

type CapabilityEntries = Pick<ClientCapabilityDeclarationInput, 'video' | 'audio'>

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
  // The lowest level of Dolby's profiles and levels specification that holds the picture.
  dolbyVisionLevel: number
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
  dolbyVisionLevel: 9,
}
const UHD_AT_30: PictureTier = {
  width: 3840,
  height: 2160,
  frameRate: 30,
  bitrate: 20_000_000,
  levels: { H264: 51, HEVC: 50, AV1: 50 },
  dolbyVisionLevel: 7,
}
const FULL_HD_AT_60: PictureTier = {
  width: 1920,
  height: 1080,
  frameRate: 60,
  bitrate: 10_000_000,
  levels: { H264: 42, HEVC: 41, AV1: 41 },
  dolbyVisionLevel: 5,
}
const FULL_HD_AT_30: PictureTier = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  bitrate: 10_000_000,
  levels: { H264: 40, HEVC: 40, AV1: 40 },
  dolbyVisionLevel: 4,
}
const HD_AT_30: PictureTier = {
  width: 1280,
  height: 720,
  frameRate: 30,
  bitrate: 5_000_000,
  levels: { H264: 31, HEVC: 31, AV1: 31 },
  dolbyVisionLevel: 2,
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

// One Dolby Vision codec string, and the profiles a player that applies its RPUs accepts.
interface DolbyVisionProbe {
  profiles: readonly DolbyVisionProfile[]
  codec: (dolbyVisionLevel: number) => string
}

interface VideoFamily {
  codecFamily: keyof FamilyLevels & VideoCodecFamily
  maxTier?: VideoCodecTier
  eightBit: BitDepthProbe
  tenBit?: BitDepthProbe
  hdr?: HdrProbe
}

interface HdrProbe {
  // The codec profiles of a 10-bit HDR stream, which every HDR entry of the family lists.
  profiles: readonly VideoCodecProfile[]
  // The 10-bit codec string an HDR question asks about, given the stream's transfer characteristics.
  codec: (level: number, transferCharacteristics: number) => string
  dolbyVision: readonly DolbyVisionProbe[]
  // A Dolby Vision codec string names no tier. Above Main tier, each profile counts only beside
  // the base named here, whose question asked the 10-bit base layer at the family's tier and the
  // entry's level, and a profile not named counts nowhere.
  dolbyVisionTierBases?: Partial<Record<DolbyVisionProfile, DeclaredCompatibleBase>>
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

const HEVC_DOLBY_VISION: readonly DolbyVisionProbe[] = [
  { profiles: ['PROFILE_5'], codec: (level) => dolbyVisionCodec('dvh1.05', level) },
  {
    profiles: ['PROFILE_8_1', 'PROFILE_8_4'],
    codec: (level) => dolbyVisionCodec('dvh1.08', level),
  },
]

const HEVC: VideoFamily = {
  codecFamily: 'HEVC',
  maxTier: 'MAIN',
  eightBit: { bitDepth: 8, profiles: ['HEVC_MAIN'], codec: (level) => `hvc1.1.6.L${level * 3}.B0` },
  tenBit: {
    bitDepth: 10,
    profiles: ['HEVC_MAIN_10'],
    codec: (level) => `hvc1.2.4.L${level * 3}.B0`,
  },
  hdr: {
    profiles: ['HEVC_MAIN_10'],
    codec: (level) => `hvc1.2.4.L${level * 3}.B0`,
    dolbyVision: HEVC_DOLBY_VISION,
  },
}

const HEVC_HIGH: VideoFamily = {
  codecFamily: 'HEVC',
  maxTier: 'HIGH',
  eightBit: { bitDepth: 8, profiles: ['HEVC_MAIN'], codec: (level) => `hvc1.1.6.H${level * 3}.B0` },
  tenBit: {
    bitDepth: 10,
    profiles: ['HEVC_MAIN_10'],
    codec: (level) => `hvc1.2.4.H${level * 3}.B0`,
  },
  hdr: {
    profiles: ['HEVC_MAIN_10'],
    codec: (level) => `hvc1.2.4.H${level * 3}.B0`,
    dolbyVision: HEVC_DOLBY_VISION,
    // Each profile needs its own base, which the server also requires of the entry. Profile 5 has
    // none, so PQ stands in for 10-bit decoding at High tier.
    dolbyVisionTierBases: { PROFILE_5: 'PQ', PROFILE_8_1: 'PQ', PROFILE_8_4: 'HLG' },
  },
}

const HEVC_LEVELS = [62, 61, 60, 52, 51, 50, 41, 40, 31] as const

// A source can signal a higher level than its picture requires. Ask each level at the same
// picture, retaining the picture limits independently. HEVC High tier starts at level 4.
function pictureTiersFor(family: VideoFamily): readonly PictureTier[] {
  if (family.codecFamily !== 'HEVC') {
    return PICTURE_TIERS
  }
  return PICTURE_TIERS.flatMap((tier) =>
    HEVC_LEVELS.filter(
      (level) => level >= tier.levels.HEVC && (family.maxTier !== 'HIGH' || level >= 40),
    ).map((level) =>
      level === tier.levels.HEVC ? tier : { ...tier, levels: { ...tier.levels, HEVC: level } },
    ),
  )
}

// AV1 Main covers both bit depths, so a 10-bit maximum also accepts 8-bit (ADR 0049): the 10-bit
// probe names no profile, and a tier declares 10-bit only beside a qualifying 8-bit answer.
const AV1: VideoFamily = {
  codecFamily: 'AV1',
  maxTier: 'MAIN',
  eightBit: { bitDepth: 8, profiles: ['AV1_MAIN'], codec: (level) => av1Codec(level, 8) },
  tenBit: { bitDepth: 10, profiles: [], codec: (level) => av1Codec(level, 10) },
  hdr: {
    profiles: ['AV1_MAIN'],
    // Omitted colour fields mean BT.709, and Chromium refuses a question whose codec string and
    // colour disagree, so an HDR question names 4:2:0 chroma, BT.2020 primaries, the stream's
    // transfer, the BT.2020 non-constant-luminance matrix and limited range.
    codec: (level, transferCharacteristics) =>
      `${av1Codec(level, 10)}.0.110.09.${transferCharacteristics}.09.0`,
    dolbyVision: [
      {
        profiles: ['PROFILE_10_0', 'PROFILE_10_1', 'PROFILE_10_4'],
        codec: (level) => dolbyVisionCodec('dav1.10', level),
      },
    ],
  },
}

function dolbyVisionCodec(codecAndProfile: string, level: number): string {
  return `${codecAndProfile}.${level.toString().padStart(2, '0')}`
}

type ColorQuestion = Pick<VideoConfiguration, 'colorGamut' | 'transferFunction' | 'hdrMetadataType'>

// Each base asks about a family's 10-bit codec string in BT.2020 primaries. PQ asks with the SMPTE
// ST 2086 static metadata that an HDR10 copy carries; HLG carries none.
// The transfer characteristics are the H.273 code points: 16 is PQ and 18 is HLG.
const COMPATIBLE_BASE_PROBES: readonly {
  base: DeclaredCompatibleBase
  transferCharacteristics: number
  color: ColorQuestion
}[] = [
  {
    base: 'PQ',
    transferCharacteristics: 16,
    color: { colorGamut: 'rec2020', transferFunction: 'pq', hdrMetadataType: 'smpteSt2086' },
  },
  {
    base: 'HLG',
    transferCharacteristics: 18,
    color: { colorGamut: 'rec2020', transferFunction: 'hlg' },
  },
]

// Dolby Vision profiles 5 and 10.0 have no compatible base, so an entry may list them without one
// (ADR 0049).
const BASELESS_DOLBY_VISION_PROFILES: ReadonlySet<DolbyVisionProfile> = new Set([
  'PROFILE_5',
  'PROFILE_10_0',
])

// H.264 is probed beside these: on WebKit, its tiers answered smooth cap power-efficient HEVC.
const VIDEO_FAMILIES_BESIDES_H264 = [HEVC, AV1, HEVC_HIGH]

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

// An entry declares more than 5.1 only for a codec whose 7.1 channels the browser hands to its audio
// graph in order: Firefox on a Mac hands 7.1 AAC over in AAC's own order.
const SURROUND_MAXIMUM = 6
const SEVEN_ONE = 8
const STEREO = 2

type SevenOneEngine = 'BLINK' | 'GECKO'
type SevenOneOperatingSystem = 'MAC_OS' | 'LINUX'

interface SevenOnePass {
  engine: SevenOneEngine
  operatingSystem: SevenOneOperatingSystem
  /** The oldest major version that passed. */
  sinceVersion: number
  codecs: readonly AudioCodec[]
}

// The `passed` rows of e2e/seven-one-channel-order.md. WebKit passed only on Linux, where it declares
// a stereo output, so no WebKit row counts.
const SEVEN_ONE_PASSES: readonly SevenOnePass[] = [
  {
    engine: 'BLINK',
    operatingSystem: 'MAC_OS',
    sinceVersion: 156,
    codecs: ['AAC', 'FLAC', 'OPUS'],
  },
  { engine: 'BLINK', operatingSystem: 'LINUX', sinceVersion: 156, codecs: ['AAC', 'FLAC', 'OPUS'] },
  { engine: 'GECKO', operatingSystem: 'MAC_OS', sinceVersion: 157, codecs: ['FLAC', 'OPUS'] },
  { engine: 'GECKO', operatingSystem: 'LINUX', sinceVersion: 157, codecs: ['AAC', 'FLAC', 'OPUS'] },
]

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

// Each answer lines up with COMPATIBLE_BASE_PROBES and the family's Dolby Vision probes.
interface HdrTierAnswers {
  tier: PictureTier
  bases: ProbeAnswer[]
  dolbyVision: ProbeAnswer[]
}

// maxChannels is null when the HLS path confirmed no channel count for the codec. The direct-play
// containers are those the media element plays the codec from, at the probed channel count.
interface AudioAnswer {
  codec: AudioCodec
  channels: number
  maxChannels: number | null
  directPlayContainers: SourceContainer[]
}

type VideoQuestion = Omit<MediaDecodingConfiguration, 'type'> & { video: VideoConfiguration }

type AskDecodingInfo = (
  configuration: Omit<MediaDecodingConfiguration, 'type'>,
) => Promise<ProbeAnswer>

interface Askers {
  /** Asks about the path that plays HLS: hls.js's media source, or the media element itself. */
  askDecodingInfo: AskDecodingInfo
  /** Asks about the media element playing a file, as direct play does. */
  askFileDecodingInfo: AskDecodingInfo
}

/**
 * What this browser plays over HLS, and from MP4 and WebM files in its own media element, built
 * fresh for each playback session from the platform's answers. Never rejects: each probe the browser rejects or leaves unanswered counts as
 * unconfirmed, and a browser without decodingInfo gets the minimal declaration.
 */
export async function declarePlaybackCapabilities(
  platform: PlaybackPlatform,
): Promise<ClientCapabilityDeclarationInput> {
  const entries = await declareEntries(platform)
  return { ...entries, selectsAudioTrackInDirectPlay: platform.selectsAudioTrackInDirectPlay }
}

async function declareEntries(platform: PlaybackPlatform): Promise<CapabilityEntries> {
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
  const askAs =
    (asked: MediaDecodingType): AskDecodingInfo =>
    (configuration) => {
      // Called inside an async function so a decodingInfo that throws synchronously becomes a
      // rejection, which settles this probe alone instead of failing every probe in the declaration.
      const answer = (async () => decodingInfo({ type: asked, ...configuration }))()
      return Promise.race([answer.catch(() => null), deadline])
    }
  // Direct play hands the file to the media element, so its questions ask about file playback.
  const askers: Askers = { askDecodingInfo: askAs(type), askFileDecodingInfo: askAs('file') }
  try {
    // The audio probes ask at the channel count the entries declare, so the output comes first.
    // A probe started after the deadline could not count, so an unanswered read starts none.
    const outputChannels = await Promise.race([
      platform.audioOutputChannels().catch(() => 0),
      deadline,
    ])
    if (outputChannels === null) {
      return minimalDeclaration(hls)
    }
    return await probeDeclaration({ platform, askers, hls, outputChannels })
  } finally {
    clearTimeout(timer)
  }
}

async function probeDeclaration({
  platform,
  askers,
  hls,
  outputChannels,
}: {
  platform: PlaybackPlatform
  askers: Askers
  hls: boolean
  outputChannels: number
}): Promise<CapabilityEntries> {
  // A host without an audio device reports 0 channels, and every output plays stereo.
  const outputPlays = Math.max(outputChannels, STEREO)
  const [video, audio] = await Promise.all([
    probeVideo({ platform, askers, hls }),
    Promise.all(
      AUDIO_CODECS.map(({ codec, mimeCodec }) =>
        probeAudio({
          codec,
          mimeCodec,
          channels: Math.min(outputPlays, channelMaximum(codec, platform.userAgent)),
          platform,
          askers,
        }),
      ),
    ),
  ])
  return {
    // The contract caps each list at 32. H.264 comes first, so omitting excess optional
    // combinations preserves the encode fallback instead of causing a declaration refusal.
    video: video.filter(appliesToADelivery).slice(0, 32),
    audio: audioEntries({ answers: audio, userAgent: platform.userAgent, hls }).filter(
      appliesToADelivery,
    ),
  }
}

// The server refuses an entry that applies neither to HLS nor to direct play from a container.
function appliesToADelivery(entry: { hls: boolean; directPlayContainers?: unknown[] }): boolean {
  return entry.hls || (entry.directPlayContainers?.length ?? 0) > 0
}

interface FamilyAnswers {
  answers: TierAnswers[]
  hdrAnswers: HdrTierAnswers[]
}

const NO_ANSWERS: FamilyAnswers = { answers: [], hdrAnswers: [] }

// Each family declares from its own answers and asks its direct-play questions as soon as they
// arrive, so a question left unanswered holds back only the families that read it: every family
// reads H.264's answers, and HEVC High tier reads Main tier's.
async function probeVideo({
  platform,
  askers,
  hls,
}: {
  platform: PlaybackPlatform
  askers: Askers
  hls: boolean
}): Promise<VideoCapabilityEntryInput[]> {
  const { askDecodingInfo } = askers
  const families = [H264, ...VIDEO_FAMILIES_BESIDES_H264]
  const probes = new Map(
    families.map((family) => [family, probeFamilyAnswers({ platform, family, askDecodingInfo })]),
  )
  const answersOf = (family: VideoFamily) => probes.get(family) ?? NO_ANSWERS
  const declared = await Promise.all(
    families.map(async (family) => {
      const [own, h264, mainTier] = await Promise.all([
        answersOf(family),
        answersOf(H264),
        family === HEVC_HIGH ? answersOf(HEVC) : NO_ANSWERS,
      ])
      const entries = familyEntries({
        platform,
        family,
        answers: own.answers,
        hdrAnswers: own.hdrAnswers,
        h264Answers: h264.answers,
        hls,
        mainAnswers: mainTier.answers,
        mainHdrAnswers: mainTier.hdrAnswers,
      })
      return withVideoDirectPlay({ platform, askers, entries })
    }),
  )
  return declared.flat()
}

async function probeFamilyAnswers({
  platform,
  family,
  askDecodingInfo,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  askDecodingInfo: AskDecodingInfo
}): Promise<FamilyAnswers> {
  const [answers, hdrAnswers] = await Promise.all([
    probeFamily({ family, askDecodingInfo }),
    probeHdr({ platform, family, askDecodingInfo }),
  ])
  return { answers, hdrAnswers }
}

// HDR shows only on an HDR display, so an SDR display asks no HDR question and declares SDR alone.
function probeHdr({
  platform,
  family,
  askDecodingInfo,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  askDecodingInfo: AskDecodingInfo
}): Promise<HdrTierAnswers[]> {
  const { hdr } = family
  if (!platform.displaysHighDynamicRange || !hdr) {
    return Promise.resolve([])
  }
  return Promise.all(
    pictureTiersFor(family).map(async (tier) => {
      const level = tier.levels[family.codecFamily]
      const [bases, dolbyVisionAnswers] = await Promise.all([
        Promise.all(
          COMPATIBLE_BASE_PROBES.map(({ transferCharacteristics, color }) =>
            askDecodingInfo(
              videoConfiguration(tier, hdr.codec(level, transferCharacteristics), color),
            ),
          ),
        ),
        Promise.all(
          // Dolby Vision's codec string names no HEVC level, so it is asked only at the lowest
          // level that holds the picture: an ordinary HEVC answer at a higher level does not widen
          // Dolby Vision support.
          hdr.dolbyVision.map((probe) =>
            PICTURE_TIERS.includes(tier)
              ? askDecodingInfo(videoConfiguration(tier, probe.codec(tier.dolbyVisionLevel)))
              : Promise.resolve(null),
          ),
        ),
      ])
      return { tier, bases, dolbyVision: dolbyVisionAnswers }
    }),
  )
}

function probeFamily({
  family,
  askDecodingInfo,
}: {
  family: VideoFamily
  askDecodingInfo: AskDecodingInfo
}): Promise<TierAnswers[]> {
  return Promise.all(
    pictureTiersFor(family).map((tier) => probeTier({ family, tier, askDecodingInfo })),
  )
}

function familyEntries({
  platform,
  family,
  answers,
  hdrAnswers,
  mainAnswers,
  mainHdrAnswers,
  h264Answers,
  hls,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  answers: readonly TierAnswers[]
  hdrAnswers: readonly HdrTierAnswers[]
  mainAnswers: readonly TierAnswers[]
  mainHdrAnswers: readonly HdrTierAnswers[]
  h264Answers: readonly TierAnswers[]
  hls: boolean
}): VideoCapabilityEntryInput[] {
  const isSupported = createConfigurationSupportCheck({
    platform,
    family,
    answers,
    mainAnswers,
    h264Answers,
    bound: withoutSmallerConfigurationRefusals,
  })
  let tiers = widestTiers(
    answers.flatMap((answer) => supportedTiers({ family, answer, isSupported })),
  )
  if (tiers.length === 0) {
    tiers = fallbackTiers({ platform, family, answers })
  }
  return [
    ...tiers.map((decodedTier) => videoEntry({ family, decodedTier, hls })),
    ...hdrEntries({ platform, family, hdrAnswers, mainAnswers: mainHdrAnswers, h264Answers, hls }),
  ]
}

interface HdrTier {
  tier: PictureTier
  compatibleBases: DeclaredCompatibleBase[]
  dolbyVisionProfiles: DolbyVisionProfileCapabilityInput[]
}

// Each HDR format counts at a tier on its own answer, under the same support rules as SDR: a 10-bit
// SDR answer says nothing about tone mapping or a decoder's lower HDR level. HDR
// tiers fold as SDR tiers do, so a tier stays when no wider tier accepts every format it does.
function hdrEntries({
  platform,
  family,
  hdrAnswers,
  mainAnswers,
  h264Answers,
  hls,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  hdrAnswers: readonly HdrTierAnswers[]
  mainAnswers: readonly HdrTierAnswers[]
  h264Answers: readonly TierAnswers[]
  hls: boolean
}): VideoCapabilityEntryInput[] {
  const { hdr } = family
  if (!hdr) {
    return []
  }
  const isSupported = createConfigurationSupportCheck({
    platform,
    family,
    answers: hdrAnswers,
    mainAnswers,
    h264Answers,
    bound: withSupportedSmallerConfigurations,
  })
  const kept: HdrTier[] = []
  for (const answers of hdrAnswers) {
    const candidate = hdrTier({ hdr, answers, isSupported })
    if (candidate && !kept.some((wider) => isHdrTierCoveredBy(candidate, wider))) {
      kept.push(candidate)
    }
  }
  return kept.map(({ tier, compatibleBases, dolbyVisionProfiles }) => ({
    ...videoEntry({
      family,
      decodedTier: { tier, bitDepth: 10, profiles: [...hdr.profiles] },
      hls,
    }),
    compatibleBases,
    dolbyVisionProfiles,
  }))
}

// A maximum accepts every smaller value (ADR 0049), so an HDR format counts at a tier only when
// every smaller tier it holds also passes the support check or went unanswered. A tier that
// decodes only with dropped frames would stutter without a playback error, so no format attempt recovers.
function withSupportedSmallerConfigurations<T extends { tier: PictureTier }>({
  answers,
  isSupported,
}: {
  answers: readonly T[]
  isSupported: ConfigurationSupportCheck<T>
}): ConfigurationSupportCheck<T> {
  return (answer, answerOf) =>
    isSupported(answer, answerOf) &&
    answers.every(
      (smaller) =>
        !holdsConfiguration(answer.tier, smaller.tier) ||
        answerOf(smaller) === null ||
        isSupported(smaller, answerOf),
    )
}

function hdrTier({
  hdr,
  answers,
  isSupported,
}: {
  hdr: HdrProbe
  answers: HdrTierAnswers
  isSupported: ConfigurationSupportCheck<HdrTierAnswers>
}): HdrTier | null {
  const { tier } = answers
  const compatibleBases = COMPATIBLE_BASE_PROBES.filter((_, index) =>
    isSupported(answers, (tierAnswers) => tierAnswers.bases[index]),
  ).map(({ base }) => base)
  const tierBases = hdr.dolbyVisionTierBases
  const dolbyVisionProfiles = hdr.dolbyVision
    .filter((_, index) => isSupported(answers, (tierAnswers) => tierAnswers.dolbyVision[index]))
    .flatMap(({ profiles }) => profiles)
    .filter((profile) => !tierBases || compatibleBases.some((base) => base === tierBases[profile]))
    .map((profile) => ({ profile, maxLevel: tier.dolbyVisionLevel }))
  const listsBaselessProfile = dolbyVisionProfiles.some(({ profile }) =>
    BASELESS_DOLBY_VISION_PROFILES.has(profile),
  )
  if (compatibleBases.length === 0 && !listsBaselessProfile) {
    return null
  }
  return { tier, compatibleBases, dolbyVisionProfiles }
}

// A wider tier's Dolby Vision level is at least the narrower tier's, since it holds the picture.
function isHdrTierCoveredBy(candidate: HdrTier, wider: HdrTier): boolean {
  const widerProfiles = new Set(wider.dolbyVisionProfiles.map(({ profile }) => profile))
  return (
    holdsConfiguration(wider.tier, candidate.tier) &&
    candidate.compatibleBases.every((base) => wider.compatibleBases.includes(base)) &&
    candidate.dolbyVisionProfiles.every(({ profile }) => widerProfiles.has(profile))
  )
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
// attempt recovers from it: only qualifying answers raise a limit. Each bit depth counts on its
// own answer, and the tier holds only the codec profiles of the supported bit depths.
function supportedTiers({
  family,
  answer,
  isSupported,
}: {
  family: VideoFamily
  answer: TierAnswers
  isSupported: ConfigurationSupportCheck<TierAnswers>
}): DecodedTier[] {
  const supportedProbes: BitDepthProbe[] = []
  if (isSupported(answer, (answers) => answers.eightBit)) {
    supportedProbes.push(family.eightBit)
  }
  if (family.tenBit && isSupported(answer, (answers) => answers.tenBit)) {
    supportedProbes.push(family.tenBit)
  }
  const profiles = supportedProbes.flatMap((probe) => probe.profiles)
  if (profiles.length === 0) {
    return []
  }
  const bitDepth = Math.max(...supportedProbes.map((probe) => probe.bitDepth))
  return [{ tier: answer.tier, bitDepth, profiles }]
}

// One probe's answer at a tier, such as the 10-bit answer of a family's tier.
type AnswerOf<T> = (answers: T) => ProbeAnswer

type ConfigurationSupportCheck<T> = (answers: T, answerOf: AnswerOf<T>) => boolean

// A High-tier maximum also accepts Main-tier streams. Both answers must support the same
// profile/base, level and picture, including each tier's lower-level and smoothness limits.
function createConfigurationSupportCheck<T extends { tier: PictureTier }>({
  platform,
  family,
  answers,
  mainAnswers,
  h264Answers,
  bound,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  answers: readonly T[]
  mainAnswers: readonly T[]
  h264Answers: readonly TierAnswers[]
  bound: (options: {
    answers: readonly T[]
    isSupported: ConfigurationSupportCheck<T>
  }) => ConfigurationSupportCheck<T>
}): ConfigurationSupportCheck<T> {
  const isSupported = bound({
    answers,
    isSupported: createPlatformSupportCheck({ platform, family, answers, h264Answers }),
  })
  if (family !== HEVC_HIGH) {
    return isSupported
  }
  const isMainTierSupported = bound({
    answers: mainAnswers,
    isSupported: createPlatformSupportCheck({
      platform,
      family: HEVC,
      answers: mainAnswers,
      h264Answers,
    }),
  })
  return (answer, answerOf) =>
    isSupported(answer, answerOf) &&
    mainAnswers.some(
      (main) =>
        holdsConfiguration(main.tier, answer.tier) &&
        holdsConfiguration(answer.tier, main.tier) &&
        isMainTierSupported(main, answerOf),
    )
}

// Safari on iOS 27.2, on a phone that decodes HEVC in hardware, answers HEVC Main and Main 10
// supported and power-efficient but never smooth, at every tier from 720p30 to 2160p60. On WebKit a
// power-efficient HEVC answer can qualify, but power efficiency says which decoder runs, not
// how fast: a phone that decodes 1080p in hardware may still drop frames at 2160p60. So a
// power-efficient HEVC answer qualifies only up to the highest H.264 tier WebKit answers smooth.
// That cap measures no decode throughput: WebKit's Cocoa decodingInfo answers H.264 smooth once
// the codec string passes its support checks and VideoToolbox is available, whatever the picture
// size or frame rate. The cap therefore holds power-efficient HEVC to the highest H.264
// configuration WebKit accepts. If WebKit answers no H.264 tier smooth, power-efficient HEVC is
// dropped and the server encodes instead. WebKit answers HEVC smooth up to the decoder's maximum
// playback level, so once a profile answers smooth at any tier, its smooth answers are its ceiling
// and power efficiency no longer stands in for them. Elsewhere only a smooth answer qualifies.
function createPlatformSupportCheck<T extends { tier: PictureTier }>({
  platform,
  family,
  answers,
  h264Answers,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  answers: readonly T[]
  h264Answers: readonly TierAnswers[]
}): ConfigurationSupportCheck<T> {
  if (family.codecFamily !== 'HEVC' || !isWebKit(platform.userAgent)) {
    return (answer, answerOf) => isSmooth(answerOf(answer))
  }
  const budget = h264Answers.filter((answer) => isSmooth(answer.eightBit))
  return (answer, answerOf) => {
    if (isSmooth(answerOf(answer))) {
      return true
    }
    if (answers.some((other) => isSmooth(answerOf(other)))) {
      return false
    }
    return (
      isPowerEfficient(answerOf(answer)) &&
      budget.some((h264) => holdsPicture(h264.tier, answer.tier))
    )
  }
}

// A maximum accepts every smaller value (ADR 0049), so no tier counts over a smaller tier it holds
// that the browser refused for the same probe.
function withoutSmallerConfigurationRefusals<T extends { tier: PictureTier }>({
  answers,
  isSupported,
}: {
  answers: readonly T[]
  isSupported: ConfigurationSupportCheck<T>
}): ConfigurationSupportCheck<T> {
  return (answer, answerOf) =>
    isSupported(answer, answerOf) &&
    !answers.some(
      (smaller) => holdsConfiguration(answer.tier, smaller.tier) && isRefusal(answerOf(smaller)),
    )
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

// H.264 is the server's encode, so without a qualifying answer it keeps its lowest tier the
// browser answered supported, at most full HD and never over a refused tier, and full HD when no
// H.264 probe was answered at all. AV1 keeps its lowest tier only on WebKit, when every answer was a refusal and the playing path
// corroborates it; a supported but unsmooth answer is not under-reporting, and an unanswered probe
// is not an answer.
function fallbackTiers({
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
    return h264FallbackTier(answered)
  }
  const isEveryAnswerARefusal =
    answered.length > 0 && answered.every((answer) => isRefusal(answer.eightBit))
  if (family === AV1 && isEveryAnswerARefusal && isAv1UnderReported(platform)) {
    return [eightBitTier(AV1, FULL_HD_AT_30)]
  }
  return []
}

function h264FallbackTier(answered: readonly TierAnswers[]): DecodedTier[] {
  if (answered.length === 0) {
    return [eightBitTier(H264, FULL_HD_AT_30)]
  }
  const lowestSupported = answered.findLast((answer) => answer.eightBit?.supported)
  if (!lowestSupported) {
    return []
  }
  // Unanswered lower tiers never raise the fallback above the full HD tier declared without answers.
  let tier = lowestSupported.tier
  if (!holdsPicture(FULL_HD_AT_30, tier)) {
    tier = FULL_HD_AT_30
  }
  if (answered.some((answer) => holdsPicture(tier, answer.tier) && isRefusal(answer.eightBit))) {
    return []
  }
  return [eightBitTier(H264, tier)]
}

function eightBitTier(family: VideoFamily, tier: PictureTier): DecodedTier {
  return { tier, bitDepth: family.eightBit.bitDepth, profiles: [...family.eightBit.profiles] }
}

function videoConfiguration(
  tier: PictureTier,
  codec: string,
  color: ColorQuestion = {},
): VideoQuestion {
  return {
    video: {
      contentType: `video/mp4; codecs="${codec}"`,
      width: tier.width,
      height: tier.height,
      framerate: tier.frameRate,
      bitrate: tier.bitrate,
      ...color,
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
    holdsConfiguration(wider.tier, candidate.tier) &&
    wider.bitDepth >= candidate.bitDepth &&
    candidate.profiles.every((profile) => wider.profiles.includes(profile))
  )
}

function holdsPicture(wider: PictureTier, tier: PictureTier): boolean {
  return (
    wider.width >= tier.width && wider.height >= tier.height && wider.frameRate >= tier.frameRate
  )
}

function holdsConfiguration(wider: PictureTier, tier: PictureTier): boolean {
  return holdsPicture(wider, tier) && wider.levels.HEVC >= tier.levels.HEVC
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

// No engine's decodingInfo answer depends on the channel count (e2e/decoding-info-channels.spec.ts),
// so one probe per codec asks at the count its entry would declare.
async function probeAudio({
  codec,
  mimeCodec,
  channels,
  platform,
  askers,
}: {
  codec: AudioCodec
  mimeCodec: string
  channels: number
  platform: PlaybackPlatform
  askers: Askers
}): Promise<AudioAnswer> {
  const audio = (contentType: string): Omit<MediaDecodingConfiguration, 'type'> => ({
    audio: { contentType, channels: String(channels), bitrate: 384_000, samplerate: 48_000 },
  })
  const playsFromFile = async ({ container, mimeType }: AudioFileType) => {
    const contentType = `${mimeType}; codecs="${mimeCodec}"`
    if (platform.canPlayType(contentType) !== 'probably') {
      return []
    }
    const answer = await askers.askFileDecodingInfo(audio(contentType))
    return answer?.supported ? [container] : []
  }
  const [answer, directPlayContainers] = await Promise.all([
    askers.askDecodingInfo(audio(`audio/mp4; codecs="${mimeCodec}"`)),
    Promise.all(audioFileTypes(codec).map(playsFromFile)).then((found) => found.flat()),
  ])
  if (!answer?.supported && channels > SURROUND_MAXIMUM) {
    return probeAudio({ codec, mimeCodec, channels: SURROUND_MAXIMUM, platform, askers })
  }
  return {
    codec,
    channels,
    maxChannels: answer?.supported ? channels : null,
    directPlayContainers,
  }
}

interface AudioFileType {
  container: SourceContainer
  mimeType: string
}

// Matroska counts only as WebM, whose audio among the declared codecs is Opus. The server sends a
// Matroska file as video/x-matroska, so the question names the Matroska type.
function audioFileTypes(codec: AudioCodec): AudioFileType[] {
  const mp4: AudioFileType = { container: 'MP4', mimeType: 'audio/mp4' }
  if (codec === 'OPUS') {
    return [mp4, { container: 'MATROSKA', mimeType: 'audio/x-matroska' }]
  }
  return [mp4]
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
  for (const { codec, channels, maxChannels, directPlayContainers } of answers) {
    if (codec === 'AAC') {
      // The server's audio encode is AAC, so every declaration carries an HLS AAC entry.
      entries.push(
        withContainers<AudioCapabilityEntryInput>(
          { codec, maxChannels: maxChannels ?? STEREO, hls: true },
          directPlayContainers,
        ),
      )
      continue
    }
    if (maxChannels === null && directPlayContainers.length === 0) {
      continue
    }
    entries.push(
      withContainers<AudioCapabilityEntryInput>(
        {
          codec,
          maxChannels: channelCap({ codec, maxChannels: maxChannels ?? channels, userAgent }),
          hls: hls && maxChannels !== null,
        },
        directPlayContainers,
      ),
    )
  }
  return entries
}

// An entry that applies to no direct play leaves the list out, which the server reads as empty.
function withContainers<T extends { directPlayContainers?: SourceContainer[] | null }>(
  entry: T,
  directPlayContainers: SourceContainer[],
): T {
  if (directPlayContainers.length === 0) {
    return entry
  }
  return { ...entry, directPlayContainers }
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

// The most channels an entry for the codec may declare in this browser.
function channelMaximum(codec: AudioCodec, userAgent: string): number {
  const engine = sevenOneEngine(userAgent)
  const operatingSystem = sevenOneOperatingSystem(userAgent)
  const passed = SEVEN_ONE_PASSES.some(
    (pass) =>
      pass.engine === engine?.engine &&
      engine.version >= pass.sinceVersion &&
      pass.operatingSystem === operatingSystem &&
      pass.codecs.includes(codec),
  )
  if (passed) {
    return SEVEN_ONE
  }
  return SURROUND_MAXIMUM
}

// Every iPhone browser names itself CriOS/ or FxiOS/ instead, and plays through WebKit.
function sevenOneEngine(userAgent: string): { engine: SevenOneEngine; version: number } | null {
  const blink = /\b(?:Chrome|Chromium)\/(\d+)/.exec(userAgent)
  if (blink) {
    return { engine: 'BLINK', version: Number(blink[1]) }
  }
  const gecko = /\bFirefox\/(\d+)/.exec(userAgent)
  if (gecko) {
    return { engine: 'GECKO', version: Number(gecko[1]) }
  }
  return null
}

function sevenOneOperatingSystem(userAgent: string): SevenOneOperatingSystem | null {
  if (userAgent.includes('Macintosh')) {
    return 'MAC_OS'
  }
  if (/Android|CrOS/.test(userAgent)) {
    return null
  }
  if (userAgent.includes('Linux')) {
    return 'LINUX'
  }
  return null
}

// Every iPhone browser is WebKit; Blink keeps AppleWebKit in its user agent beside Chrome/.
function isWebKit(userAgent: string): boolean {
  return /AppleWebKit\//.test(userAgent) && !/\b(?:Chrome|Chromium)\//.test(userAgent)
}

// The sample entries that name a coding format in an MP4 file, keyed by the one each probe's codec
// string starts with. A browser may play a format from one sample entry and not another: WebKit
// plays hvc1 and avc1 files, never hev1 or avc3.
const SAMPLE_ENTRIES: Record<string, readonly { sampleEntry: VideoSampleEntry; fourCc: string }[]> =
  {
    avc1: [
      { sampleEntry: 'AVC1', fourCc: 'avc1' },
      { sampleEntry: 'AVC3', fourCc: 'avc3' },
    ],
    hvc1: [
      { sampleEntry: 'HVC1', fourCc: 'hvc1' },
      { sampleEntry: 'HEV1', fourCc: 'hev1' },
    ],
    av01: [{ sampleEntry: 'AV01', fourCc: 'av01' }],
  }

const VIDEO_FAMILIES: Partial<Record<VideoCodecFamily, VideoFamily>> = { H264, HEVC, AV1 }

// Direct play reuses each entry's limits, so the media element must play a file at the entry's
// widest picture for every stream the entry accepts. A sample entry counts only when the element
// plays every such stream from it, and MP4 counts only beside a sample entry, as the server
// requires. Matroska counts only as WebM, whose video among the declared families is AV1.
// Direct play never carries Dolby Vision until a real Dolby Vision file proves that a browser
// applies its RPUs: one that shows them without RPUs shows wrong colours and reports no error, so
// no format attempt recovers. An HDR entry that lists Dolby Vision profiles stays for HLS, and a
// separate entry without them applies to direct play.
async function withVideoDirectPlay({
  platform,
  askers,
  entries,
}: {
  platform: PlaybackPlatform
  askers: Askers
  entries: VideoCapabilityEntryInput[]
}): Promise<VideoCapabilityEntryInput[]> {
  const declared = await Promise.all(
    entries.map(async (entry): Promise<VideoCapabilityEntryInput[]> => {
      const family = VIDEO_FAMILIES[entry.codecFamily]
      if (!family || entry.compatibleBases.length === 0) {
        return [entry]
      }
      const directPlay = { ...entry, dolbyVisionProfiles: [] }
      const families =
        family === HEVC && entry.codecProfiles.some(({ maxTier }) => maxTier === 'HIGH')
          ? [HEVC, HEVC_HIGH]
          : [family]
      const questions = families.flatMap((family) => entryQuestions({ family, entry: directPlay }))
      const playsAll = (asked: readonly VideoQuestion[]) =>
        playsEveryFile({ platform, family, askers, questions: asked })
      const [sampleEntries, matroska] = await Promise.all([
        mp4SampleEntries({ questions, playsAll }),
        family === AV1 ? playsAll(questions.map((question) => inMatroska(question))) : false,
      ])
      const containers: SourceContainer[] = []
      if (sampleEntries.length > 0) {
        containers.push('MP4')
      }
      if (matroska) {
        containers.push('MATROSKA')
      }
      if (containers.length === 0) {
        return [entry]
      }
      const directPlayFields = {
        directPlayContainers: containers,
        directPlaySampleEntries: sampleEntries,
      }
      if (entry.dolbyVisionProfiles.length > 0) {
        return [entry, { ...directPlay, hls: false, ...directPlayFields }]
      }
      return [{ ...entry, ...directPlayFields }]
    }),
  )
  return declared.flat()
}

async function mp4SampleEntries({
  questions,
  playsAll,
}: {
  questions: readonly VideoQuestion[]
  playsAll: (asked: readonly VideoQuestion[]) => Promise<boolean>
}): Promise<VideoSampleEntry[]> {
  const byFourCc = new Map<string, VideoQuestion[]>()
  for (const question of questions) {
    const fourCc = fourCcOf(question)
    byFourCc.set(fourCc, [...(byFourCc.get(fourCc) ?? []), question])
  }
  const accepted = await Promise.all(
    [...byFourCc].flatMap(([fourCc, asked]) =>
      (SAMPLE_ENTRIES[fourCc] ?? []).map(async ({ sampleEntry, fourCc: relabelled }) => {
        const plays = await playsAll(asked.map((question) => withFourCc(question, relabelled)))
        return plays ? [sampleEntry] : []
      }),
    ),
  )
  return accepted.flat()
}

async function playsEveryFile({
  platform,
  family,
  askers,
  questions,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  askers: Askers
  questions: readonly VideoQuestion[]
}): Promise<boolean> {
  if (
    questions.length === 0 ||
    questions.some(({ video }) => platform.canPlayType(video.contentType) !== 'probably')
  ) {
    return false
  }
  const answers = await Promise.all(
    questions.map(async (question) => {
      const [file, hls] = await Promise.all([
        askers.askFileDecodingInfo(question),
        askers.askDecodingInfo(question),
      ])
      return { file, hls }
    }),
  )
  return answers.every((answer) => isFileConfigurationSupported({ platform, family, ...answer }))
}

// A file configuration qualifies when its answer is smooth. Power efficiency stands in only for
// HEVC on WebKit, and only where the HLS answer at the same picture was not smooth either: the
// entry then holds the H.264 cap, which a file decoder that drops frames below the HLS one's
// smooth ceiling would not.
function isFileConfigurationSupported({
  platform,
  family,
  file,
  hls,
}: {
  platform: PlaybackPlatform
  family: VideoFamily
  file: ProbeAnswer
  hls: ProbeAnswer
}): boolean {
  if (isSmooth(file)) {
    return true
  }
  return family === HEVC && isWebKit(platform.userAgent) && isPowerEfficient(file) && !isSmooth(hls)
}

// The questions whose answers made the entry: one per bit depth of its SDR profiles, or one per
// compatible base of an HDR entry, at its widest picture.
function entryQuestions({
  family,
  entry,
}: {
  family: VideoFamily
  entry: VideoCapabilityEntryInput
}): VideoQuestion[] {
  const tier = PICTURE_TIERS.find(
    ({ width, height, frameRate }) =>
      width === entry.maxWidth && height === entry.maxHeight && frameRate === entry.maxFrameRate,
  )
  if (!tier) {
    return []
  }
  const level = entry.codecProfiles[0].maxLevel
  const { hdr } = family
  if (!entry.compatibleBases.includes('SDR') && hdr) {
    return hdrQuestions({ hdr, tier, entry })
  }
  const profiles = new Set(entry.codecProfiles.map(({ profile }) => profile))
  return [family.eightBit, family.tenBit]
    .filter((probe) => probe !== undefined)
    .filter(
      (probe) =>
        probe.bitDepth <= entry.maxBitDepth &&
        (probe.profiles.length === 0 || probe.profiles.some((profile) => profiles.has(profile))),
    )
    .map((probe) => videoConfiguration(tier, probe.codec(level)))
}

function hdrQuestions({
  hdr,
  tier,
  entry,
}: {
  hdr: HdrProbe
  tier: PictureTier
  entry: VideoCapabilityEntryInput
}): VideoQuestion[] {
  const level = entry.codecProfiles[0].maxLevel
  return COMPATIBLE_BASE_PROBES.filter(({ base }) => entry.compatibleBases.includes(base)).map(
    ({ transferCharacteristics, color }) =>
      videoConfiguration(tier, hdr.codec(level, transferCharacteristics), color),
  )
}

const CODECS_PARAMETER = /codecs="(\w{4})/

function fourCcOf({ video }: VideoQuestion): string {
  return CODECS_PARAMETER.exec(video.contentType)?.[1] ?? ''
}

function withFourCc(question: VideoQuestion, fourCc: string): VideoQuestion {
  const contentType = question.video.contentType.replace(CODECS_PARAMETER, `codecs="${fourCc}`)
  return { ...question, video: { ...question.video, contentType } }
}

// The server sends a Matroska file, WebM included, as video/x-matroska.
function inMatroska(question: VideoQuestion): VideoQuestion {
  const contentType = question.video.contentType.replace('video/mp4', 'video/x-matroska')
  return { ...question, video: { ...question.video, contentType } }
}

function minimalDeclaration(hls: boolean): CapabilityEntries {
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

async function audioOutputChannels(): Promise<number> {
  // TypeScript's DOM library declares AudioContext in every browser; older browsers lack it.
  const scope: { AudioContext?: typeof AudioContext } = globalThis
  if (!scope.AudioContext) {
    return 0
  }
  const context = new scope.AudioContext()
  try {
    return context.destination.maxChannelCount
  } finally {
    await context.close()
  }
}

// The video plane can show HDR where the rest of the page cannot, as on a television.
function displaysHighDynamicRange(): boolean {
  // TypeScript's DOM library declares matchMedia in every browser; a test environment may lack it.
  const scope: { matchMedia?: (query: string) => MediaQueryList } = globalThis
  if (!scope.matchMedia) {
    return false
  }
  return (
    scope.matchMedia('(dynamic-range: high)').matches ||
    scope.matchMedia('(video-dynamic-range: high)').matches
  )
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
    audioOutputChannels,
    displaysHighDynamicRange: displaysHighDynamicRange(),
    // Only WebKit lists every audio track of a file and switches among them. Chromium lists them
    // only behind an experimental flag, and Firefox, behind media.track.enabled, lists only one.
    selectsAudioTrackInDirectPlay:
      isWebKit(navigator.userAgent) && Reflect.get(video, 'audioTracks') !== undefined,
  }
  // WebKit on Linux plays audio through GStreamer. On the Linux CI runner, its web process crashed
  // on the next media call after a page read maxChannelCount, so there it declares stereo. The
  // platform names the operating system even where a quirk or a test sets a Mac user agent.
  if (isWebKit(navigator.userAgent) && navigator.platform.startsWith('Linux')) {
    platform.audioOutputChannels = () => Promise.resolve(0)
  }
  if ('mediaCapabilities' in navigator) {
    platform.decodingInfo = (configuration) =>
      navigator.mediaCapabilities.decodingInfo(configuration)
  }
  return platform
}
