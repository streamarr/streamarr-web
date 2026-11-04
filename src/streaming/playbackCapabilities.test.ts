import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AudioCapabilityEntryInput,
  ClientCapabilityDeclarationInput,
  VideoCapabilityEntryInput,
} from '../graphql/generated/graphql'
import {
  CHROME_USER_AGENT,
  IPHONE_SAFARI_HEVC_ANSWER,
  IPHONE_SAFARI_USER_AGENT,
  MINIMAL_DECLARATION,
  playbackPlatformFixture,
  smoothUpToFullHd,
} from '../test/playbackCapabilities'
import {
  browserPlaybackPlatform,
  declarePlaybackCapabilities,
  type DecodingAnswer,
  type PlaybackPlatform,
} from './playbackCapabilities'

const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1'
const FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0'
const LINUX_CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'

const AV1_PROBE = 'video/mp4; codecs="av01.0.08M.08"'

type Decodes = (configuration: MediaDecodingConfiguration) => boolean

function codecOf(configuration: MediaDecodingConfiguration): string {
  const contentType = configuration.video?.contentType ?? configuration.audio?.contentType ?? ''
  return /codecs="([^"]+)"/.exec(contentType)?.[1] ?? ''
}

function decodingInfoAnswering(decodes: Decodes, isSmooth: Decodes = () => true) {
  return vi.fn((configuration: MediaDecodingConfiguration) => {
    const supported = decodes(configuration)
    const smooth = supported && isSmooth(configuration)
    return Promise.resolve({ supported, smooth, powerEfficient: smooth })
  })
}

function isFullHdAtThirtyFrames(configuration: MediaDecodingConfiguration): boolean {
  return configuration.video?.width === 1920 && configuration.video.framerate === 30
}

// Maximum bitrates in bits per second, keyed by the level each codec string carries: H.264 Table
// A-1 (MaxBR × cpbBrVclFactor 1250 for the High profile), H.265 Table A.8 (Main-tier MaxBR ×
// CpbVclFactor 1000), AV1 Annex A.3 (MainMbps), and WebKit's AV1 table, which counts a megabit as
// 2^20 bits and refuses a configuration above it before asking the decoder (WebCore
// AV1Utilities.cpp).
const LEVEL_BITRATE_MAXIMUMS: Record<string, number> = {
  '64001F': 17_500_000,
  '640028': 25_000_000,
  '64002A': 62_500_000,
  '640033': 300_000_000,
  '640034': 300_000_000,
  L93: 10_000_000,
  L120: 12_000_000,
  L123: 20_000_000,
  L150: 25_000_000,
  L153: 40_000_000,
  '05M': 10_000_000,
  '08M': 12_000_000,
  '09M': 20_000_000,
  '12M': 30_000_000,
  '13M': 40_000_000,
}
const WEBKIT_AV1_MAIN_TIER_BITRATES: Record<string, number> = {
  '05M': 10 * 2 ** 20,
  '08M': 12 * 2 ** 20,
  '09M': 20 * 2 ** 20,
  '12M': 30 * 2 ** 20,
  '13M': 40 * 2 ** 20,
}

function isWithinBitrateMaximum(
  configuration: MediaDecodingConfiguration,
  bitrates: Record<string, number>,
): boolean {
  const level = codecOf(configuration)
    .split('.')
    .find((part) => part in bitrates)
  // A refusal, not a throw: the declaration counts a throwing probe as unanswered, and an
  // unanswered tier blocks nothing, so a malformed codec string would pass unseen.
  if (level === undefined) {
    return false
  }
  return (configuration.video?.bitrate ?? 0) <= bitrates[level]
}

function platformFixture(overrides: Partial<PlaybackPlatform> = {}): PlaybackPlatform {
  return playbackPlatformFixture({ decodingInfo: decodingInfoAnswering(() => true), ...overrides })
}

function sdrVideoEntry(entry: Partial<VideoCapabilityEntryInput>): VideoCapabilityEntryInput {
  return {
    codecFamily: 'H264',
    codecProfiles: [],
    maxBitDepth: 8,
    maxWidth: 1920,
    maxHeight: 1080,
    maxFrameRate: 30,
    compatibleBases: ['SDR'],
    dolbyVisionProfiles: [],
    hdr10Plus: false,
    hls: true,
    ...entry,
  }
}

function h264Profiles(maxLevel: number) {
  return [
    { profile: 'H264_HIGH' as const, maxLevel },
    { profile: 'H264_MAIN' as const, maxLevel },
    { profile: 'H264_CONSTRAINED_BASELINE' as const, maxLevel },
  ]
}

function familyEntries(declaration: ClientCapabilityDeclarationInput, family: string) {
  return declaration.video.filter((entry) => entry.codecFamily === family)
}

function audioEntry(
  declaration: ClientCapabilityDeclarationInput,
  codec: string,
): AudioCapabilityEntryInput | undefined {
  return declaration.audio.find((entry) => entry.codec === codec)
}

function decodesOnly(codecs: string[]): Decodes {
  return (configuration) => codecs.includes(codecOf(configuration))
}

function answer(supported: boolean): DecodingAnswer {
  return { supported, smooth: supported, powerEfficient: supported }
}

const NEVER_ANSWERED = new Promise<DecodingAnswer>(() => {})

type Answers = (configuration: MediaDecodingConfiguration) => DecodingAnswer

function decodingInfoAnsweringHevc(hevcAnswer: Answers, otherAnswer: Answers = () => answer(true)) {
  return vi.fn((configuration: MediaDecodingConfiguration) => {
    if (codecOf(configuration).startsWith('hvc1')) {
      return Promise.resolve(hevcAnswer(configuration))
    }
    return Promise.resolve(otherAnswer(configuration))
  })
}

function isUhd(configuration: MediaDecodingConfiguration): boolean {
  return configuration.video?.height === 2160
}

const UNSMOOTH_SOFTWARE_ANSWER: DecodingAnswer = {
  supported: true,
  smooth: false,
  powerEfficient: false,
}

function smoothMainTenAndPowerEfficientMain(
  configuration: MediaDecodingConfiguration,
): DecodingAnswer {
  if (codecOf(configuration).startsWith('hvc1.2')) {
    return answer(true)
  }
  return IPHONE_SAFARI_HEVC_ANSWER
}

const UHD_AT_60_HEVC_MAIN_TEN_ENTRY = sdrVideoEntry({
  codecFamily: 'HEVC',
  codecProfiles: [{ profile: 'HEVC_MAIN_10', maxLevel: 51, maxTier: 'MAIN' }],
  maxBitDepth: 10,
  maxWidth: 3840,
  maxHeight: 2160,
  maxFrameRate: 60,
})

function decodesOnlyAt720p(configuration: MediaDecodingConfiguration): boolean {
  return configuration.video === undefined || configuration.video.height === 720
}

const DECLARATION_OF_THE_720P_ONLY_BROWSER_WITHOUT_OPUS: ClientCapabilityDeclarationInput = {
  video: [
    sdrVideoEntry({ codecProfiles: h264Profiles(31), maxWidth: 1280, maxHeight: 720 }),
    sdrVideoEntry({
      codecFamily: 'HEVC',
      codecProfiles: [
        { profile: 'HEVC_MAIN', maxLevel: 31, maxTier: 'MAIN' },
        { profile: 'HEVC_MAIN_10', maxLevel: 31, maxTier: 'MAIN' },
      ],
      maxBitDepth: 10,
      maxWidth: 1280,
      maxHeight: 720,
    }),
    sdrVideoEntry({
      codecFamily: 'AV1',
      codecProfiles: [{ profile: 'AV1_MAIN', maxLevel: 31, maxTier: 'MAIN' }],
      maxBitDepth: 10,
      maxWidth: 1280,
      maxHeight: 720,
    }),
  ],
  audio: [
    { codec: 'AAC', maxChannels: 6, hls: true },
    { codec: 'AC3', maxChannels: 6, hls: true },
    { codec: 'EAC3', maxChannels: 6, hls: true },
    { codec: 'FLAC', maxChannels: 6, hls: true },
    { codec: 'ALAC', maxChannels: 6, hls: true },
  ],
}

const DECLARATION_OF_EVERY_TIER: ClientCapabilityDeclarationInput = {
  video: [
    sdrVideoEntry({
      codecFamily: 'H264',
      codecProfiles: h264Profiles(52),
      maxWidth: 3840,
      maxHeight: 2160,
      maxFrameRate: 60,
    }),
    sdrVideoEntry({
      codecFamily: 'HEVC',
      codecProfiles: [
        { profile: 'HEVC_MAIN', maxLevel: 51, maxTier: 'MAIN' },
        { profile: 'HEVC_MAIN_10', maxLevel: 51, maxTier: 'MAIN' },
      ],
      maxBitDepth: 10,
      maxWidth: 3840,
      maxHeight: 2160,
      maxFrameRate: 60,
    }),
    sdrVideoEntry({
      codecFamily: 'AV1',
      codecProfiles: [{ profile: 'AV1_MAIN', maxLevel: 51, maxTier: 'MAIN' }],
      maxBitDepth: 10,
      maxWidth: 3840,
      maxHeight: 2160,
      maxFrameRate: 60,
    }),
  ],
  audio: [
    { codec: 'AAC', maxChannels: 6, hls: true },
    { codec: 'AC3', maxChannels: 6, hls: true },
    { codec: 'EAC3', maxChannels: 6, hls: true },
    { codec: 'OPUS', maxChannels: 6, hls: true },
    { codec: 'FLAC', maxChannels: 6, hls: true },
    { codec: 'ALAC', maxChannels: 6, hls: true },
  ],
}

type CompatibleBase = 'PQ' | 'HLG'

const HEVC_PROFILES_AT_LEVEL_51 = [
  { profile: 'HEVC_MAIN' as const, maxLevel: 51, maxTier: 'MAIN' as const },
  { profile: 'HEVC_MAIN_10' as const, maxLevel: 51, maxTier: 'MAIN' as const },
]

const UHD_AT_60_HEVC_ENTRY = sdrVideoEntry({
  codecFamily: 'HEVC',
  codecProfiles: HEVC_PROFILES_AT_LEVEL_51,
  maxBitDepth: 10,
  maxWidth: 3840,
  maxHeight: 2160,
  maxFrameRate: 60,
})

const UHD_AT_60_AV1_ENTRY = sdrVideoEntry({
  codecFamily: 'AV1',
  codecProfiles: [{ profile: 'AV1_MAIN', maxLevel: 51, maxTier: 'MAIN' }],
  maxBitDepth: 10,
  maxWidth: 3840,
  maxHeight: 2160,
  maxFrameRate: 60,
})

// HDR10, HLG and Dolby Vision profiles 5 and 8 are 10-bit HEVC Main 10 streams. AV1 Main covers
// 10-bit too.
function hevcMainTen(maxLevel: number) {
  return [{ profile: 'HEVC_MAIN_10' as const, maxLevel, maxTier: 'MAIN' as const }]
}

/** An HEVC HDR entry with PQ and HLG at 2160p60, unless the caller names other values. */
function hdrVideoEntry(entry: Partial<VideoCapabilityEntryInput>): VideoCapabilityEntryInput {
  return sdrVideoEntry({
    codecFamily: 'HEVC',
    codecProfiles: hevcMainTen(51),
    maxBitDepth: 10,
    maxWidth: 3840,
    maxHeight: 2160,
    maxFrameRate: 60,
    compatibleBases: ['PQ', 'HLG'],
    ...entry,
  })
}

const UHD_AT_60_HEVC_HDR_ENTRY = hdrVideoEntry({})

const UHD_AT_60_AV1_HDR_ENTRY = hdrVideoEntry({
  codecFamily: 'AV1',
  codecProfiles: [{ profile: 'AV1_MAIN', maxLevel: 51, maxTier: 'MAIN' }],
})

// An HDR10 stream is 10-bit PQ in BT.2020 primaries with SMPTE ST 2086 static metadata, and an HLG
// stream is 10-bit HLG in BT.2020 primaries with no static metadata. An AV1 codecs parameter also
// names the colour (AV1 Codec ISO Media File Format Binding): 4:2:0 chroma, BT.2020 primaries (9),
// PQ (16) or HLG (18) transfer, the BT.2020 non-constant-luminance matrix (9) and limited range.
// Omitted, those fields mean BT.709, and Chromium refuses a question whose codec string and colour
// disagree.
const AV1_TRANSFER_CHARACTERISTICS: Record<CompatibleBase, string> = { PQ: '16', HLG: '18' }

function asksAbout(configuration: MediaDecodingConfiguration, base: CompatibleBase): boolean {
  const { video } = configuration
  const codec = codecOf(configuration)
  const av1Colour = `0.110.09.${AV1_TRANSFER_CHARACTERISTICS[base]}.09.0`
  const isTenBit =
    codec.startsWith('hvc1.2.') ||
    new RegExp(`^av01\\.0\\.\\d{2}M\\.10\\.${av1Colour}$`).test(codec)
  if (!video || !isTenBit || video.colorGamut !== 'rec2020') {
    return false
  }
  if (base === 'PQ') {
    return video.transferFunction === 'pq' && video.hdrMetadataType === 'smpteSt2086'
  }
  return video.transferFunction === 'hlg' && video.hdrMetadataType === undefined
}

// The Dolby Vision level that each picture tier needs, from Dolby's profiles and levels
// specification: level 2 is 1280x720 at 30 fps, 4 is 1920x1080 at 30, 5 is 1920x1080 at 60, 7 is
// 3840x2160 at 30 and 9 is 3840x2160 at 60.
const DOLBY_VISION_LEVEL_BY_PICTURE: Record<string, number> = {
  '720p30': 2,
  '1080p30': 4,
  '1080p60': 5,
  '2160p30': 7,
  '2160p60': 9,
}

function asksAboutDolbyVision(
  configuration: MediaDecodingConfiguration,
  codecPrefixes: readonly string[],
): boolean {
  const match = /^(dvh1\.05|dvh1\.08|dav1\.10)\.(\d{2})$/.exec(codecOf(configuration))
  const video = configuration.video
  if (!match || !video || !codecPrefixes.includes(match[1])) {
    return false
  }
  const needed = DOLBY_VISION_LEVEL_BY_PICTURE[`${video.height}p${video.framerate}`]
  return Number(match[2]) >= needed
}

/**
 * A browser on an HDR display that decodes every SDR configuration smoothly, shows the given
 * compatible bases, and applies the RPUs of the given Dolby Vision codec strings.
 */
function hdrBrowser({
  bases = ['PQ', 'HLG'],
  dolbyVision = [],
}: {
  bases?: readonly CompatibleBase[]
  dolbyVision?: readonly string[]
} = {}) {
  return vi.fn((configuration: MediaDecodingConfiguration) => {
    if (configuration.video?.transferFunction !== undefined) {
      return Promise.resolve(answer(bases.some((base) => asksAbout(configuration, base))))
    }
    if (/^(dvh1|dav1)/.test(codecOf(configuration))) {
      return Promise.resolve(answer(asksAboutDolbyVision(configuration, dolbyVision)))
    }
    return Promise.resolve(answer(true))
  })
}

function hdrPlatformFixture(overrides: Partial<PlaybackPlatform> = {}): PlaybackPlatform {
  return platformFixture({
    decodingInfo: hdrBrowser(),
    displaysHighDynamicRange: true,
    ...overrides,
  })
}

describe('declarePlaybackCapabilities', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldDeclareOneEntryPerFamilyWhenTheBrowserDecodesEveryTier', async () => {
    const declaration = await declarePlaybackCapabilities(platformFixture())

    expect(declaration.video).toEqual(DECLARATION_OF_EVERY_TIER.video)
  })

  it('shouldDeclareEachLimitPairingWhenFourKDecodesOnlyAtThirtyFrames', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) =>
            !(configuration.video?.width === 3840 && configuration.video.framerate === 60),
        ),
      }),
    )

    expect(familyEntries(declaration, 'H264')).toEqual([
      sdrVideoEntry({ codecProfiles: h264Profiles(51), maxWidth: 3840, maxHeight: 2160 }),
      sdrVideoEntry({ codecProfiles: h264Profiles(42), maxFrameRate: 60 }),
    ])
  })

  it('shouldDeclareFourKAv1AtThirtyFramesWhenWebKitDecodesFourKAt60OnlyWithDroppedFrames', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) =>
            !codecOf(configuration).startsWith('av01') ||
            isWithinBitrateMaximum(configuration, WEBKIT_AV1_MAIN_TIER_BITRATES),
          (configuration) => configuration.video?.framerate !== 60,
        ),
        userAgent: SAFARI,
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toEqual([
      sdrVideoEntry({
        codecFamily: 'AV1',
        codecProfiles: [{ profile: 'AV1_MAIN', maxLevel: 50, maxTier: 'MAIN' }],
        maxBitDepth: 10,
        maxWidth: 3840,
        maxHeight: 2160,
      }),
    ])
  })

  it('shouldDeclareEveryTierWhenTheBrowserRefusesEveryConfigurationAboveItsLevelsBitrateMaximum', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) =>
            configuration.video === undefined ||
            isWithinBitrateMaximum(configuration, LEVEL_BITRATE_MAXIMUMS),
        ),
      }),
    )

    expect(declaration.video).toEqual(DECLARATION_OF_EVERY_TIER.video)
  })

  it('shouldBoundEachFamilyToItsSmoothTiersWhenHigherTiersDecodeOnlyWithDroppedFrames', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          () => true,
          (configuration) =>
            configuration.audio !== undefined || isFullHdAtThirtyFrames(configuration),
        ),
      }),
    )

    expect(declaration.video).toEqual([
      sdrVideoEntry({ codecProfiles: h264Profiles(40) }),
      sdrVideoEntry({
        codecFamily: 'HEVC',
        codecProfiles: [
          { profile: 'HEVC_MAIN', maxLevel: 40, maxTier: 'MAIN' },
          { profile: 'HEVC_MAIN_10', maxLevel: 40, maxTier: 'MAIN' },
        ],
        maxBitDepth: 10,
      }),
      sdrVideoEntry({
        codecFamily: 'AV1',
        codecProfiles: [{ profile: 'AV1_MAIN', maxLevel: 40, maxTier: 'MAIN' }],
        maxBitDepth: 10,
      }),
    ])
  })

  it('shouldDeclareEightBitWhenTenBitDecodesOnlyWithDroppedFrames', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          () => true,
          (configuration) =>
            !codecOf(configuration).startsWith('hvc1.2') && !codecOf(configuration).endsWith('.10'),
        ),
      }),
    )

    expect(
      declaration.video.map(({ codecFamily, codecProfiles, maxBitDepth }) => ({
        codecFamily,
        profiles: codecProfiles.map(({ profile }) => profile),
        maxBitDepth,
      })),
    ).toEqual([
      {
        codecFamily: 'H264',
        profiles: ['H264_HIGH', 'H264_MAIN', 'H264_CONSTRAINED_BASELINE'],
        maxBitDepth: 8,
      },
      { codecFamily: 'HEVC', profiles: ['HEVC_MAIN'], maxBitDepth: 8 },
      { codecFamily: 'AV1', profiles: ['AV1_MAIN'], maxBitDepth: 8 },
    ])
  })

  it('shouldDeclareNoAv1WhenOnlyTheTenBitProbeKeepsUp', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          () => true,
          (configuration) => !codecOf(configuration).endsWith('M.08'),
        ),
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toEqual([])
  })

  it('shouldDeclare720pWhenH264DecodesSmoothlyOnlyAt720p', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          () => true,
          (configuration) =>
            !codecOf(configuration).startsWith('avc1') || configuration.video?.height === 720,
        ),
      }),
    )

    expect(familyEntries(declaration, 'H264')).toEqual([
      sdrVideoEntry({ codecProfiles: h264Profiles(31), maxWidth: 1280, maxHeight: 720 }),
    ])
  })

  it('shouldKeepTheLowestH264TierWhenNoH264TierDecodesSmoothly', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          () => true,
          (configuration) => !codecOf(configuration).startsWith('avc1'),
        ),
      }),
    )

    expect(familyEntries(declaration, 'H264')).toEqual([
      sdrVideoEntry({ codecProfiles: h264Profiles(31), maxWidth: 1280, maxHeight: 720 }),
    ])
  })

  it('shouldDropHevcWhenItDecodesOnlyWithDroppedFrames', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          () => true,
          (configuration) => !codecOf(configuration).startsWith('hvc1'),
        ),
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([])
  })

  it.each([
    ['MediaSource', true],
    ['NativePlayer', false],
  ])(
    'shouldDeclareHevcWhenIphoneSafariAnswersItPowerEfficientButNotSmoothThroughThe%s',
    async (_, hlsJsSupported) => {
      const declaration = await declarePlaybackCapabilities(
        platformFixture({
          decodingInfo: decodingInfoAnsweringHevc(() => IPHONE_SAFARI_HEVC_ANSWER),
          hlsJsSupported,
          nativeHlsSupported: true,
          userAgent: IPHONE_SAFARI_USER_AGENT,
        }),
      )

      expect(familyEntries(declaration, 'HEVC')).toEqual([
        sdrVideoEntry({
          codecFamily: 'HEVC',
          codecProfiles: [
            { profile: 'HEVC_MAIN', maxLevel: 51, maxTier: 'MAIN' },
            { profile: 'HEVC_MAIN_10', maxLevel: 51, maxTier: 'MAIN' },
          ],
          maxBitDepth: 10,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 60,
        }),
      ])
    },
  )

  it('shouldDeclareEightBitHevcWhenWebKitAnswersOnlyMainPowerEfficient', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnsweringHevc((configuration) =>
          codecOf(configuration).startsWith('hvc1.2')
            ? UNSMOOTH_SOFTWARE_ANSWER
            : IPHONE_SAFARI_HEVC_ANSWER,
        ),
        userAgent: SAFARI,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      sdrVideoEntry({
        codecFamily: 'HEVC',
        codecProfiles: [{ profile: 'HEVC_MAIN', maxLevel: 51, maxTier: 'MAIN' }],
        maxWidth: 3840,
        maxHeight: 2160,
        maxFrameRate: 60,
      }),
    ])
  })

  it('shouldCapPowerEfficientHevcAtTheHighestTierH264KeepsUpWithWhenWebKitNeverAnswersHevcSmooth', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnsweringHevc(() => IPHONE_SAFARI_HEVC_ANSWER, smoothUpToFullHd),
        userAgent: IPHONE_SAFARI_USER_AGENT,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      sdrVideoEntry({
        codecFamily: 'HEVC',
        codecProfiles: [
          { profile: 'HEVC_MAIN', maxLevel: 41, maxTier: 'MAIN' },
          { profile: 'HEVC_MAIN_10', maxLevel: 41, maxTier: 'MAIN' },
        ],
        maxBitDepth: 10,
        maxFrameRate: 60,
      }),
    ])
  })

  it('shouldHoldHevcToItsSmoothTiersWhenWebKitAnswersHevcSmoothBelowFourKAndOnlyPowerEfficientAtFourK', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnsweringHevc((configuration) =>
          isUhd(configuration) ? IPHONE_SAFARI_HEVC_ANSWER : answer(true),
        ),
        userAgent: IPHONE_SAFARI_USER_AGENT,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      sdrVideoEntry({
        codecFamily: 'HEVC',
        codecProfiles: [
          { profile: 'HEVC_MAIN', maxLevel: 41, maxTier: 'MAIN' },
          { profile: 'HEVC_MAIN_10', maxLevel: 41, maxTier: 'MAIN' },
        ],
        maxBitDepth: 10,
        maxFrameRate: 60,
      }),
    ])
  })

  it('shouldCapPowerEfficientHevcAtEightBitWhenMainTenIsPowerEfficientOnlyAboveTheH264Cap', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnsweringHevc(
          (configuration) =>
            codecOf(configuration).startsWith('hvc1.2') && !isUhd(configuration)
              ? UNSMOOTH_SOFTWARE_ANSWER
              : IPHONE_SAFARI_HEVC_ANSWER,
          smoothUpToFullHd,
        ),
        userAgent: IPHONE_SAFARI_USER_AGENT,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      sdrVideoEntry({
        codecFamily: 'HEVC',
        codecProfiles: [{ profile: 'HEVC_MAIN', maxLevel: 41, maxTier: 'MAIN' }],
        maxFrameRate: 60,
      }),
    ])
  })

  it('shouldDropPowerEfficientHevcWhenWebKitAnswersNoH264TierSmooth', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnsweringHevc(
          () => IPHONE_SAFARI_HEVC_ANSWER,
          () => UNSMOOTH_SOFTWARE_ANSWER,
        ),
        userAgent: IPHONE_SAFARI_USER_AGENT,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([])
  })

  it('shouldDeclareMainTenAboveTheH264CapWhenWebKitAnswersMainTenSmoothAndMainOnlyPowerEfficient', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnsweringHevc(
          smoothMainTenAndPowerEfficientMain,
          smoothUpToFullHd,
        ),
        userAgent: IPHONE_SAFARI_USER_AGENT,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      UHD_AT_60_HEVC_MAIN_TEN_ENTRY,
      sdrVideoEntry({
        codecFamily: 'HEVC',
        codecProfiles: [
          { profile: 'HEVC_MAIN', maxLevel: 41, maxTier: 'MAIN' },
          { profile: 'HEVC_MAIN_10', maxLevel: 41, maxTier: 'MAIN' },
        ],
        maxBitDepth: 10,
        maxFrameRate: 60,
      }),
    ])
  })

  it('shouldDeclareSmoothMainTenAloneWhenWebKitAnswersNoH264TierSmooth', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnsweringHevc(
          smoothMainTenAndPowerEfficientMain,
          () => UNSMOOTH_SOFTWARE_ANSWER,
        ),
        userAgent: IPHONE_SAFARI_USER_AGENT,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([UHD_AT_60_HEVC_MAIN_TEN_ENTRY])
  })

  it('shouldDeclareHevcAboveTheHighestTierH264KeepsUpWithWhenWebKitAnswersHevcSmooth', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnsweringHevc(() => answer(true), smoothUpToFullHd),
        userAgent: IPHONE_SAFARI_USER_AGENT,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      sdrVideoEntry({
        codecFamily: 'HEVC',
        codecProfiles: [
          { profile: 'HEVC_MAIN', maxLevel: 51, maxTier: 'MAIN' },
          { profile: 'HEVC_MAIN_10', maxLevel: 51, maxTier: 'MAIN' },
        ],
        maxBitDepth: 10,
        maxWidth: 3840,
        maxHeight: 2160,
        maxFrameRate: 60,
      }),
    ])
  })

  it('shouldDropHevcWhenWebKitDecodesItOnlyWithDroppedFramesAndNotPowerEfficiently', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnsweringHevc(() => UNSMOOTH_SOFTWARE_ANSWER),
        userAgent: SAFARI,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([])
  })

  it.each([
    ['Chrome', CHROME_USER_AGENT],
    ['Firefox', FIREFOX],
  ])('shouldDropHevcWhen%sAnswersItPowerEfficientButNotSmooth', async (_, userAgent) => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnsweringHevc(() => IPHONE_SAFARI_HEVC_ANSWER),
        userAgent,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([])
  })

  it('shouldDropAv1WhenWebKitAnswersItPowerEfficientButNotSmooth', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (codecOf(configuration).startsWith('av01')) {
            return Promise.resolve(IPHONE_SAFARI_HEVC_ANSWER)
          }
          return Promise.resolve(answer(true))
        }),
        userAgent: IPHONE_SAFARI_USER_AGENT,
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toEqual([])
  })

  it('shouldDropAv1WhenItDecodesOnlyWithDroppedFramesEvenWhenMediaSourceAcceptsIt', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          () => true,
          (configuration) => !codecOf(configuration).startsWith('av01'),
        ),
        mediaSourceTypeSupported: (type) => type === AV1_PROBE,
        userAgent: SAFARI,
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toEqual([])
  })

  it('shouldEncodeEachLevelAsMajorTimesTenPlusMinorWhenTheBrowserAnswersForThatLevel', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          decodesOnly([
            'avc1.64002A',
            'avc1.640028',
            'avc1.64001F',
            'hvc1.1.6.L123.B0',
            'hvc1.1.6.L120.B0',
            'hvc1.1.6.L93.B0',
            'av01.0.09M.08',
            'av01.0.08M.08',
            'av01.0.05M.08',
            'mp4a.40.2',
          ]),
        ),
      }),
    )

    expect(declaration.video).toEqual([
      sdrVideoEntry({ codecProfiles: h264Profiles(42), maxFrameRate: 60 }),
      sdrVideoEntry({
        codecFamily: 'HEVC',
        codecProfiles: [{ profile: 'HEVC_MAIN', maxLevel: 41, maxTier: 'MAIN' }],
        maxFrameRate: 60,
      }),
      sdrVideoEntry({
        codecFamily: 'AV1',
        codecProfiles: [{ profile: 'AV1_MAIN', maxLevel: 41, maxTier: 'MAIN' }],
        maxFrameRate: 60,
      }),
    ])
  })

  it('shouldDeclareNoVideoMaximumWhenTheBrowserRefusesTheSmallerTiersItHolds', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) =>
            configuration.video === undefined ||
            (configuration.video.width === 1920 && configuration.video.framerate === 60),
        ),
      }),
    )

    expect(declaration.video).toEqual([])
  })

  it('shouldKeepEightBitHevcWhenTheBrowserRefusesOnlyMainTenAt720p', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) =>
            !(codecOf(configuration).startsWith('hvc1.2') && configuration.video?.height === 720),
        ),
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      sdrVideoEntry({
        codecFamily: 'HEVC',
        codecProfiles: [{ profile: 'HEVC_MAIN', maxLevel: 51, maxTier: 'MAIN' }],
        maxWidth: 3840,
        maxHeight: 2160,
        maxFrameRate: 60,
      }),
    ])
  })

  it('shouldKeepAv1WhenMediaSourceCorroboratesAFalseDecodingAnswer', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) => !codecOf(configuration).startsWith('av01'),
        ),
        mediaSourceTypeSupported: (type) => type === AV1_PROBE,
        userAgent: SAFARI,
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toEqual([
      sdrVideoEntry({
        codecFamily: 'AV1',
        codecProfiles: [{ profile: 'AV1_MAIN', maxLevel: 40, maxTier: 'MAIN' }],
      }),
    ])
  })

  it('shouldKeepAv1WhenTheNativePlayerCorroboratesAFalseDecodingAnswer', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) => !codecOf(configuration).startsWith('av01'),
        ),
        hlsJsSupported: false,
        nativeHlsSupported: true,
        canPlayType: (type) => (type === AV1_PROBE ? 'probably' : ''),
        userAgent: SAFARI,
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toEqual([
      sdrVideoEntry({
        codecFamily: 'AV1',
        codecProfiles: [{ profile: 'AV1_MAIN', maxLevel: 40, maxTier: 'MAIN' }],
      }),
    ])
  })

  it('shouldDropAv1WhenTheNativePlayerOnlyMaybePlaysItAfterAFalseDecodingAnswer', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) => !codecOf(configuration).startsWith('av01'),
        ),
        hlsJsSupported: false,
        nativeHlsSupported: true,
        canPlayType: (type) => (type === AV1_PROBE ? 'maybe' : ''),
        userAgent: SAFARI,
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toEqual([])
  })

  it.each([
    ['Chrome', CHROME_USER_AGENT],
    ['Firefox', FIREFOX],
  ])('shouldDropAv1When%sRefusesItEvenWhenMediaSourceAcceptsIt', async (_, userAgent) => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) => !codecOf(configuration).startsWith('av01'),
        ),
        mediaSourceTypeSupported: (type) => type === AV1_PROBE,
        userAgent,
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toEqual([])
  })

  it('shouldDropAv1WhenTheMediaSourceHlsJsPlaysThroughRefusesItEvenWhenTheElementAccepts', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) => !codecOf(configuration).startsWith('av01'),
        ),
        canPlayType: (type) => (type === AV1_PROBE ? 'probably' : ''),
        userAgent: SAFARI,
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toEqual([])
  })

  it('shouldDeclareTheMediaSourceAnswersWhenHlsJsPlays', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) => configuration.type === 'media-source',
        ),
      }),
    )

    expect(declaration).toEqual(DECLARATION_OF_EVERY_TIER)
  })

  it('shouldDeclareTheFilePlaybackAnswersWhenOnlyNativeHlsPlays', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering((configuration) => configuration.type === 'file'),
        hlsJsSupported: false,
        nativeHlsSupported: true,
      }),
    )

    expect(declaration).toEqual(DECLARATION_OF_EVERY_TIER)
  })

  it('shouldApplyOnlyTheRequiredAacEntryToHlsWhenTheBrowserPlaysNoHls', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({ hlsJsSupported: false, nativeHlsSupported: false }),
    )

    expect(
      [...declaration.video, ...declaration.audio]
        .filter((entry) => entry.hls)
        .map((entry) => ('codec' in entry ? entry.codec : entry.codecFamily)),
    ).toEqual(['AAC'])
  })

  it('shouldDeclareStereoAacForHlsWhenTheBrowserDecodesNoAudio', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering((configuration) => configuration.audio === undefined),
      }),
    )

    expect(declaration.audio).toEqual([{ codec: 'AAC', maxChannels: 2, hls: true }])
  })

  it('shouldDeclareSixChannelsForEveryAudioCodecWhenTheOutputPlaysEightChannels', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({ audioOutputChannels: () => Promise.resolve(8) }),
    )

    expect(declaration.audio).toEqual(DECLARATION_OF_EVERY_TIER.audio)
  })

  it.each([
    [6, 6],
    [4, 4],
    [2, 2],
    [1, 2],
    [0, 2],
  ])(
    'shouldCapEveryAudioCodecWhenTheOutputPlays%iChannels',
    async (outputChannels, declaredChannels) => {
      const declaration = await declarePlaybackCapabilities(
        platformFixture({ audioOutputChannels: () => Promise.resolve(outputChannels) }),
      )

      expect(declaration.audio.map((entry) => entry.maxChannels)).toEqual(
        Array(6).fill(declaredChannels),
      )
    },
  )

  it('shouldDeclareEveryAudioCodecInStereoWhenReadingTheOutputFails', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        audioOutputChannels: () =>
          Promise.reject(new DOMException('No device', 'NotSupportedError')),
      }),
    )

    expect(declaration.audio.map((entry) => entry.maxChannels)).toEqual([2, 2, 2, 2, 2, 2])
  })

  it('shouldAskDecodingInfoAtTheOutputsChannelCountWhenTheOutputPlaysFourChannels', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) =>
            configuration.audio === undefined || configuration.audio.channels === '4',
        ),
        audioOutputChannels: () => Promise.resolve(4),
      }),
    )

    expect(declaration.audio.map((entry) => entry.maxChannels)).toEqual([4, 4, 4, 4, 4, 4])
  })

  it('shouldAskNoDecodingInfoQuestionWhenTheOutputLeavesItsChannelCountUnansweredAtTheDeadline', async () => {
    vi.useFakeTimers()
    const asked: MediaDecodingConfiguration[] = []
    const declaration = declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: (configuration) => {
          asked.push(configuration)
          return Promise.resolve(answer(true))
        },
        audioOutputChannels: () => new Promise<number>(() => {}),
      }),
    )

    await vi.advanceTimersByTimeAsync(3_000)

    await expect(declaration).resolves.toEqual(MINIMAL_DECLARATION)
    expect(asked).toEqual([])
  })

  it.each([
    ['Safari', SAFARI],
    ['ChromeOnTheIphone', IPHONE_CHROME],
  ])('shouldDeclareStereoOpusWhen%sConfirmsSurroundOpus', async (_, userAgent) => {
    const declaration = await declarePlaybackCapabilities(platformFixture({ userAgent }))

    expect(audioEntry(declaration, 'OPUS')?.maxChannels).toBe(2)
    expect(audioEntry(declaration, 'AAC')?.maxChannels).toBe(6)
  })

  it('shouldNotDeclareAlacWhenTheBrowserDoesNotConfirmIt', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering((configuration) => codecOf(configuration) !== 'alac'),
      }),
    )

    expect(audioEntry(declaration, 'ALAC')).toBeUndefined()
  })

  it('shouldDeclareTheMinimalDeclarationWhenTheBrowserLacksDecodingInfo', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({ decodingInfo: undefined }),
    )

    expect(declaration).toEqual(MINIMAL_DECLARATION)
  })

  it('shouldKeepEveryOtherAnswerWhenThe720pOnlyBrowserRejectsTheOpusProbe', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (codecOf(configuration) === 'opus') {
            return Promise.reject(new TypeError('Unsupported configuration'))
          }
          return Promise.resolve(answer(decodesOnlyAt720p(configuration)))
        }),
      }),
    )

    expect(declaration).toEqual(DECLARATION_OF_THE_720P_ONLY_BROWSER_WITHOUT_OPUS)
  })

  it('shouldKeepEveryOtherAnswerWhenThe720pOnlyBrowserThrowsForTheOpusProbe', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (codecOf(configuration) === 'opus') {
            throw new TypeError('Unsupported configuration')
          }
          return Promise.resolve(answer(decodesOnlyAt720p(configuration)))
        }),
      }),
    )

    expect(declaration).toEqual(DECLARATION_OF_THE_720P_ONLY_BROWSER_WITHOUT_OPUS)
  })

  it('shouldKeepEveryOtherAnswerWhenThe720pOnlyBrowserLeavesProbesUnanswered', async () => {
    vi.useFakeTimers()
    const declaration = declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (codecOf(configuration) === 'opus' || configuration.video?.height === 1080) {
            return NEVER_ANSWERED
          }
          return Promise.resolve(answer(decodesOnlyAt720p(configuration)))
        }),
      }),
    )

    await vi.advanceTimersByTimeAsync(3_000)

    await expect(declaration).resolves.toEqual(DECLARATION_OF_THE_720P_ONLY_BROWSER_WITHOUT_OPUS)
  })

  it('shouldKeepEveryAnswerWhenTheBrowserAnswersJustBeforeTheThreeSecondDeadline', async () => {
    vi.useFakeTimers()
    const declaration = declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn(
          (configuration: MediaDecodingConfiguration) =>
            new Promise<DecodingAnswer>((resolve) => {
              const answered = answer(
                codecOf(configuration) !== 'opus' && decodesOnlyAt720p(configuration),
              )
              setTimeout(() => resolve(answered), 2_999)
            }),
        ),
      }),
    )

    await vi.advanceTimersByTimeAsync(2_999)

    await expect(declaration).resolves.toEqual(DECLARATION_OF_THE_720P_ONLY_BROWSER_WITHOUT_OPUS)
  })

  it('shouldDeclareNoH264WhenTheBrowserRefusesEveryAnsweredH264Tier', async () => {
    vi.useFakeTimers()
    const declaration = declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (!codecOf(configuration).startsWith('avc1')) {
            return Promise.resolve(answer(true))
          }
          if (configuration.video?.height === 720) {
            return NEVER_ANSWERED
          }
          return Promise.resolve(answer(false))
        }),
      }),
    )

    await vi.advanceTimersByTimeAsync(3_000)

    expect(familyEntries(await declaration, 'H264')).toEqual([])
  })

  it('shouldDeclareTheLowestSupportedH264TierWhenNoH264TierIsSmoothAndALowerTierGoesUnanswered', async () => {
    vi.useFakeTimers()
    const declaration = declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (!codecOf(configuration).startsWith('avc1')) {
            return Promise.resolve(answer(true))
          }
          if (configuration.video?.height === 720) {
            return NEVER_ANSWERED
          }
          if (isFullHdAtThirtyFrames(configuration)) {
            return Promise.resolve({ supported: true, smooth: false, powerEfficient: false })
          }
          return Promise.resolve(answer(false))
        }),
      }),
    )

    await vi.advanceTimersByTimeAsync(3_000)

    expect(familyEntries(await declaration, 'H264')).toEqual([
      sdrVideoEntry({ codecProfiles: h264Profiles(40) }),
    ])
  })

  it('shouldDeclareNoMoreThanFullHdH264WhenOnlyAnUnsmoothFourKTierIsAnswered', async () => {
    vi.useFakeTimers()
    const declaration = declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (!codecOf(configuration).startsWith('avc1')) {
            return Promise.resolve(answer(false))
          }
          if (configuration.video?.width === 3840 && configuration.video.framerate === 60) {
            return Promise.resolve(UNSMOOTH_SOFTWARE_ANSWER)
          }
          return NEVER_ANSWERED
        }),
      }),
    )

    await vi.advanceTimersByTimeAsync(3_000)

    expect(familyEntries(await declaration, 'H264')).toEqual([
      sdrVideoEntry({ codecProfiles: h264Profiles(40) }),
    ])
  })

  it('shouldDeclareNoH264WhenOnlyAnUnsmoothFourKTierIsSupportedAndFullHdIsRefused', async () => {
    vi.useFakeTimers()
    const declaration = declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (!codecOf(configuration).startsWith('avc1')) {
            return Promise.resolve(answer(false))
          }
          if (configuration.video?.width === 3840 && configuration.video.framerate === 60) {
            return Promise.resolve(UNSMOOTH_SOFTWARE_ANSWER)
          }
          if (isFullHdAtThirtyFrames(configuration)) {
            return Promise.resolve(answer(false))
          }
          return NEVER_ANSWERED
        }),
      }),
    )

    await vi.advanceTimersByTimeAsync(3_000)

    expect(familyEntries(await declaration, 'H264')).toEqual([])
  })

  it('shouldDeclareNoH264WhenTheOnlySupportedH264TierHoldsARefused720pTier', async () => {
    vi.useFakeTimers()
    const declaration = declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (!codecOf(configuration).startsWith('avc1')) {
            return Promise.resolve(answer(false))
          }
          if (isFullHdAtThirtyFrames(configuration)) {
            return Promise.resolve(UNSMOOTH_SOFTWARE_ANSWER)
          }
          if (configuration.video?.height === 720) {
            return Promise.resolve(answer(false))
          }
          return NEVER_ANSWERED
        }),
      }),
    )

    await vi.advanceTimersByTimeAsync(3_000)

    expect(familyEntries(await declaration, 'H264')).toEqual([])
  })

  it('shouldDeclareFullHdH264AndKeepEveryOtherAnswerWhenEveryH264ProbeFails', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (codecOf(configuration).startsWith('avc1')) {
            return Promise.reject(new TypeError('Unsupported configuration'))
          }
          return Promise.resolve(answer(true))
        }),
      }),
    )

    expect(familyEntries(declaration, 'H264')).toEqual(MINIMAL_DECLARATION.video)
    expect(familyEntries(declaration, 'HEVC')).toHaveLength(1)
    expect(audioEntry(declaration, 'AAC')?.maxChannels).toBe(6)
  })

  it('shouldDropAv1WhenNoAv1ProbeIsAnsweredEvenWhenMediaSourceAcceptsIt', async () => {
    vi.useFakeTimers()
    const declaration = declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (codecOf(configuration).startsWith('av01')) {
            return NEVER_ANSWERED
          }
          return Promise.resolve(answer(true))
        }),
        mediaSourceTypeSupported: (type) => type === AV1_PROBE,
        userAgent: SAFARI,
      }),
    )

    await vi.advanceTimersByTimeAsync(3_000)

    expect(familyEntries(await declaration, 'AV1')).toEqual([])
  })

  it('shouldDeclareTheMinimalDeclarationWhenDecodingInfoNeverAnswers', async () => {
    vi.useFakeTimers()
    const declaration = declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: vi.fn(() => NEVER_ANSWERED),
      }),
    )

    await vi.advanceTimersByTimeAsync(3_000)

    await expect(declaration).resolves.toEqual(MINIMAL_DECLARATION)
  })

  it('shouldAddAnHevcAndAnAv1HdrEntryWithPqAndHlgWhenTheDisplayShowsBoth', async () => {
    const declaration = await declarePlaybackCapabilities(hdrPlatformFixture())

    expect(declaration.video).toEqual([
      DECLARATION_OF_EVERY_TIER.video[0],
      UHD_AT_60_HEVC_ENTRY,
      UHD_AT_60_HEVC_HDR_ENTRY,
      UHD_AT_60_AV1_ENTRY,
      UHD_AT_60_AV1_HDR_ENTRY,
    ])
  })

  it('shouldDeclareOnlySdrWhenTheDisplayShowsNoHdrAlthoughTheBrowserDecodesEveryHdrFormat', async () => {
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: hdrBrowser({ dolbyVision: ['dvh1.05', 'dvh1.08', 'dav1.10'] }),
        displaysHighDynamicRange: false,
      }),
    )

    expect(declaration.video).toEqual(DECLARATION_OF_EVERY_TIER.video)
  })

  it.each([['PQ'], ['HLG']] as const)(
    'shouldDeclareOnly%sWhenTheBrowserShowsOnlyThatCompatibleBase',
    async (base) => {
      const declaration = await declarePlaybackCapabilities(
        hdrPlatformFixture({ decodingInfo: hdrBrowser({ bases: [base] }) }),
      )

      expect(familyEntries(declaration, 'HEVC')).toEqual([
        UHD_AT_60_HEVC_ENTRY,
        hdrVideoEntry({ compatibleBases: [base] }),
      ])
    },
  )

  it('shouldAddNoHdrEntryWhenTheBrowserShowsNeitherPqNorHlgNorDolbyVision', async () => {
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({ decodingInfo: hdrBrowser({ bases: [] }) }),
    )

    expect(declaration.video).toEqual(DECLARATION_OF_EVERY_TIER.video)
  })

  it('shouldAddNoHdrEntryWhenHdrDecodesOnlyWithDroppedFramesAlthoughSdrKeepsUp', async () => {
    const browser = hdrBrowser({ dolbyVision: ['dvh1.05', 'dvh1.08', 'dav1.10'] })
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: vi.fn(async (configuration: MediaDecodingConfiguration) => {
          const answered = await browser(configuration)
          const isHdrQuestion =
            configuration.video?.transferFunction !== undefined ||
            /^(dvh1|dav1)/.test(codecOf(configuration))
          if (isHdrQuestion && answered.supported) {
            return { supported: true, smooth: false, powerEfficient: true }
          }
          return answered
        }),
      }),
    )

    expect(declaration.video).toEqual(DECLARATION_OF_EVERY_TIER.video)
  })

  it('shouldDeclareEachHdrPairingWhenFourKDecodesOnlyAtThirtyFrames', async () => {
    const browser = hdrBrowser({ dolbyVision: ['dvh1.08'] })
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (configuration.video?.width === 3840 && configuration.video.framerate === 60) {
            return Promise.resolve(answer(false))
          }
          return browser(configuration)
        }),
      }),
    )
    const profileEight = (maxLevel: number) => [
      { profile: 'PROFILE_8_1' as const, maxLevel },
      { profile: 'PROFILE_8_4' as const, maxLevel },
    ]

    expect(
      familyEntries(declaration, 'HEVC').filter((entry) => entry.compatibleBases[0] !== 'SDR'),
    ).toEqual([
      hdrVideoEntry({
        codecProfiles: hevcMainTen(50),
        maxFrameRate: 30,
        dolbyVisionProfiles: profileEight(7),
      }),
      hdrVideoEntry({
        codecProfiles: hevcMainTen(41),
        maxWidth: 1920,
        maxHeight: 1080,
        dolbyVisionProfiles: profileEight(5),
      }),
    ])
  })

  it('shouldDeclarePqUpToTheLargestPictureItShowsWhenTheBrowserRefusesPqOnlyAtFourK', async () => {
    const browser = hdrBrowser()
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (
            configuration.video?.transferFunction === 'pq' &&
            configuration.video.width === 3840
          ) {
            return Promise.resolve(answer(false))
          }
          return browser(configuration)
        }),
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      UHD_AT_60_HEVC_ENTRY,
      hdrVideoEntry({ compatibleBases: ['HLG'] }),
      hdrVideoEntry({ codecProfiles: hevcMainTen(41), maxWidth: 1920, maxHeight: 1080 }),
    ])
  })

  it('shouldDeclareProfileFiveAtThirtyFramesBesidePqAtSixtyWhenTheBrowserDecodesDolbyVisionOnlyUpToFourKAtThirty', async () => {
    const browser = hdrBrowser({ dolbyVision: ['dvh1.05'] })
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (
            codecOf(configuration).startsWith('dvh1') &&
            configuration.video?.framerate === 60 &&
            configuration.video.width === 3840
          ) {
            return Promise.resolve(answer(false))
          }
          return browser(configuration)
        }),
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      UHD_AT_60_HEVC_ENTRY,
      UHD_AT_60_HEVC_HDR_ENTRY,
      hdrVideoEntry({
        codecProfiles: hevcMainTen(50),
        maxFrameRate: 30,
        dolbyVisionProfiles: [{ profile: 'PROFILE_5', maxLevel: 7 }],
      }),
      hdrVideoEntry({
        codecProfiles: hevcMainTen(41),
        maxWidth: 1920,
        maxHeight: 1080,
        dolbyVisionProfiles: [{ profile: 'PROFILE_5', maxLevel: 5 }],
      }),
    ])
  })

  it('shouldDeclareNoPqWhenTheBrowserRefusesPqForASmallerPictureTheEntryHolds', async () => {
    const browser = hdrBrowser()
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (
            configuration.video?.transferFunction === 'pq' &&
            configuration.video.height === 720
          ) {
            return Promise.resolve(answer(false))
          }
          return browser(configuration)
        }),
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      UHD_AT_60_HEVC_ENTRY,
      hdrVideoEntry({ compatibleBases: ['HLG'] }),
    ])
  })

  it('shouldDeclareNoPqWhenTheBrowserDecodesPqOnlyWithDroppedFramesForASmallerPicture', async () => {
    const browser = hdrBrowser()
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (
            configuration.video?.transferFunction === 'pq' &&
            configuration.video.height === 720
          ) {
            return Promise.resolve(UNSMOOTH_SOFTWARE_ANSWER)
          }
          return browser(configuration)
        }),
      }),
    )

    expect(declaration.video).toEqual([
      DECLARATION_OF_EVERY_TIER.video[0],
      UHD_AT_60_HEVC_ENTRY,
      hdrVideoEntry({ compatibleBases: ['HLG'] }),
      UHD_AT_60_AV1_ENTRY,
      { ...UHD_AT_60_AV1_HDR_ENTRY, compatibleBases: ['HLG'] },
    ])
  })

  it('shouldKeepHlgWhenTheBrowserLeavesHlgUnansweredOnlyForASmallerPicture', async () => {
    vi.useFakeTimers()
    const browser = hdrBrowser()
    const declaration = declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (
            configuration.video?.transferFunction === 'hlg' &&
            configuration.video.height === 720
          ) {
            return NEVER_ANSWERED
          }
          return browser(configuration)
        }),
      }),
    )

    await vi.advanceTimersByTimeAsync(3_000)

    expect(familyEntries(await declaration, 'HEVC')).toEqual([
      UHD_AT_60_HEVC_ENTRY,
      UHD_AT_60_HEVC_HDR_ENTRY,
    ])
  })

  it('shouldDeclareNoDolbyVisionProfileWhenTheBrowserDecodesItOnlyWithDroppedFramesForASmallerPicture', async () => {
    const browser = hdrBrowser({ dolbyVision: ['dvh1.08'] })
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (codecOf(configuration).startsWith('dvh1') && configuration.video?.height === 720) {
            return Promise.resolve(UNSMOOTH_SOFTWARE_ANSWER)
          }
          return browser(configuration)
        }),
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      UHD_AT_60_HEVC_ENTRY,
      UHD_AT_60_HEVC_HDR_ENTRY,
    ])
  })

  it.each([
    ['Rejects', () => Promise.reject(new TypeError('unsupported dictionary member'))],
    [
      'Throws',
      () => {
        throw new TypeError('unsupported dictionary member')
      },
    ],
    ['NeverAnswers', () => NEVER_ANSWERED],
  ])(
    'shouldDeclareOnlyHlgAndKeepEverySdrEntryWhenTheBrowser%sForThePqQuestion',
    async (_, pqAnswer: () => Promise<DecodingAnswer>) => {
      vi.useFakeTimers()
      const browser = hdrBrowser()
      const declaration = declarePlaybackCapabilities(
        hdrPlatformFixture({
          decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
            if (configuration.video?.transferFunction === 'pq') {
              return pqAnswer()
            }
            return browser(configuration)
          }),
        }),
      )

      await vi.advanceTimersByTimeAsync(3_000)

      expect((await declaration).video).toEqual([
        DECLARATION_OF_EVERY_TIER.video[0],
        UHD_AT_60_HEVC_ENTRY,
        hdrVideoEntry({ compatibleBases: ['HLG'] }),
        UHD_AT_60_AV1_ENTRY,
        { ...UHD_AT_60_AV1_HDR_ENTRY, compatibleBases: ['HLG'] },
      ])
    },
  )

  it('shouldDeclareHevcHdrWhenIphoneSafariAnswersItPowerEfficientButNotSmooth', async () => {
    const browser = hdrBrowser()
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: vi.fn(async (configuration: MediaDecodingConfiguration) => {
          const answered = await browser(configuration)
          if (answered.supported && codecOf(configuration).startsWith('hvc1')) {
            return IPHONE_SAFARI_HEVC_ANSWER
          }
          return answered
        }),
        userAgent: IPHONE_SAFARI_USER_AGENT,
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      UHD_AT_60_HEVC_ENTRY,
      UHD_AT_60_HEVC_HDR_ENTRY,
    ])
  })

  it('shouldListHevcDolbyVisionProfilesAtTheEntrysLevelWhenTheBrowserDecodesDvh1', async () => {
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({ decodingInfo: hdrBrowser({ dolbyVision: ['dvh1.05', 'dvh1.08'] }) }),
    )

    expect(declaration.video).toEqual([
      DECLARATION_OF_EVERY_TIER.video[0],
      UHD_AT_60_HEVC_ENTRY,
      hdrVideoEntry({
        dolbyVisionProfiles: [
          { profile: 'PROFILE_5', maxLevel: 9 },
          { profile: 'PROFILE_8_1', maxLevel: 9 },
          { profile: 'PROFILE_8_4', maxLevel: 9 },
        ],
      }),
      UHD_AT_60_AV1_ENTRY,
      UHD_AT_60_AV1_HDR_ENTRY,
    ])
  })

  it('shouldListAv1DolbyVisionProfilesAtTheEntrysLevelWhenTheBrowserDecodesDav1', async () => {
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({ decodingInfo: hdrBrowser({ dolbyVision: ['dav1.10'] }) }),
    )

    expect(declaration.video).toEqual([
      DECLARATION_OF_EVERY_TIER.video[0],
      UHD_AT_60_HEVC_ENTRY,
      UHD_AT_60_HEVC_HDR_ENTRY,
      UHD_AT_60_AV1_ENTRY,
      {
        ...UHD_AT_60_AV1_HDR_ENTRY,
        dolbyVisionProfiles: [
          { profile: 'PROFILE_10_0', maxLevel: 9 },
          { profile: 'PROFILE_10_1', maxLevel: 9 },
          { profile: 'PROFILE_10_4', maxLevel: 9 },
        ],
      },
    ])
  })

  it('shouldDeclareNoDolbyVisionProfileWhenTheBrowserRefusesItForASmallerPictureTheEntryHolds', async () => {
    const browser = hdrBrowser({ dolbyVision: ['dvh1.08'] })
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({
        decodingInfo: vi.fn((configuration: MediaDecodingConfiguration) => {
          if (codecOf(configuration).startsWith('dvh1') && configuration.video?.height === 720) {
            return Promise.resolve(answer(false))
          }
          return browser(configuration)
        }),
      }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      UHD_AT_60_HEVC_ENTRY,
      UHD_AT_60_HEVC_HDR_ENTRY,
    ])
  })

  it('shouldKeepAnHdrEntryWithoutACompatibleBaseWhenItListsDolbyVisionProfileFive', async () => {
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({ decodingInfo: hdrBrowser({ bases: [], dolbyVision: ['dvh1.05'] }) }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([
      UHD_AT_60_HEVC_ENTRY,
      hdrVideoEntry({
        compatibleBases: [],
        dolbyVisionProfiles: [{ profile: 'PROFILE_5', maxLevel: 9 }],
      }),
    ])
  })

  it('shouldAddNoHdrEntryWhenItWouldListOnlyProfileEightWithoutACompatibleBase', async () => {
    const declaration = await declarePlaybackCapabilities(
      hdrPlatformFixture({ decodingInfo: hdrBrowser({ bases: [], dolbyVision: ['dvh1.08'] }) }),
    )

    expect(familyEntries(declaration, 'HEVC')).toEqual([UHD_AT_60_HEVC_ENTRY])
  })
})

// An AudioContext whose default output plays maxChannelCount channels, and whose close() settles
// when closed does.
function audioContextReporting({
  maxChannelCount,
  closed = Promise.resolve(),
}: {
  maxChannelCount: number
  closed?: Promise<void>
}) {
  return class {
    readonly destination = { maxChannelCount }
    close(): Promise<void> {
      return closed
    }
  }
}

describe('browserPlaybackPlatform', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shouldAskTheMediaSourceHlsJsAttachesThroughWhenTheBrowserAlsoOffersManagedMediaSource', () => {
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
    vi.stubGlobal('ManagedMediaSource', { isTypeSupported: () => false })

    const platform = browserPlaybackPlatform(document.createElement('video'))

    expect(platform.mediaSourceTypeSupported(AV1_PROBE)).toBe(true)
  })

  it('shouldAskManagedMediaSourceWhenTheBrowserOffersNoMediaSource', () => {
    vi.stubGlobal('MediaSource', undefined)
    vi.stubGlobal('ManagedMediaSource', { isTypeSupported: () => true })

    const platform = browserPlaybackPlatform(document.createElement('video'))

    expect(platform.mediaSourceTypeSupported(AV1_PROBE)).toBe(true)
  })

  it('shouldAskWebKitMediaSourceWhenTheBrowserOffersNeitherMediaSourceNorManagedMediaSource', () => {
    vi.stubGlobal('MediaSource', undefined)
    vi.stubGlobal('ManagedMediaSource', undefined)
    vi.stubGlobal('WebKitMediaSource', { isTypeSupported: () => true })

    const platform = browserPlaybackPlatform(document.createElement('video'))

    expect(platform.mediaSourceTypeSupported(AV1_PROBE)).toBe(true)
  })

  it.each([
    ['maybe', true],
    ['probably', true],
    ['', false],
  ] as const)(
    'shouldDecideNativeHlsFromTheElementWhenItAnswers"%s"ForTheHlsPlaylistType',
    (answered, nativeHlsSupported) => {
      const video = document.createElement('video')
      video.canPlayType = (type) => (type === 'application/vnd.apple.mpegurl' ? answered : '')

      const platform = browserPlaybackPlatform(video)

      expect(platform.nativeHlsSupported).toBe(nativeHlsSupported)
    },
  )

  it('shouldAcceptNoMediaSourceTypeWhenTheBrowserOffersNoMediaSource', () => {
    vi.stubGlobal('MediaSource', undefined)
    vi.stubGlobal('ManagedMediaSource', undefined)
    vi.stubGlobal('WebKitMediaSource', undefined)

    const platform = browserPlaybackPlatform(document.createElement('video'))

    expect(platform.mediaSourceTypeSupported(AV1_PROBE)).toBe(false)
  })

  it('shouldAnswerCanPlayTypeFromTheElementThatPlaysTheStreamWhenAsked', () => {
    const video = document.createElement('video')
    video.canPlayType = (type) => (type === AV1_PROBE ? 'probably' : '')

    const platform = browserPlaybackPlatform(video)

    expect(platform.canPlayType(AV1_PROBE)).toBe('probably')
  })

  it('shouldAnswerFromTheBrowsersDecodingInfoWhenTheBrowserOffersMediaCapabilities', async () => {
    vi.stubGlobal('navigator', {
      userAgent: SAFARI,
      platform: 'MacIntel',
      mediaCapabilities: {
        decodingInfo: (configuration: MediaDecodingConfiguration) =>
          Promise.resolve({
            supported: configuration.video?.contentType === AV1_PROBE,
            smooth: true,
            powerEfficient: false,
          }),
      },
    })
    const configuration: MediaDecodingConfiguration = {
      type: 'media-source',
      video: { contentType: AV1_PROBE, width: 1920, height: 1080, framerate: 30, bitrate: 1 },
    }

    const platform = browserPlaybackPlatform(document.createElement('video'))

    await expect(platform.decodingInfo?.(configuration)).resolves.toEqual({
      supported: true,
      smooth: true,
      powerEfficient: false,
    })
  })

  it('shouldReadTheUserAgentFromTheBrowserWhenBindingThePlatform', () => {
    vi.stubGlobal('navigator', { userAgent: SAFARI, platform: 'MacIntel' })

    const platform = browserPlaybackPlatform(document.createElement('video'))

    expect(platform.userAgent).toBe(SAFARI)
  })

  it('shouldAnswerTheDefaultOutputsChannelMaximumWhenTheBrowserOffersAudioContext', async () => {
    vi.stubGlobal('navigator', { userAgent: SAFARI, platform: 'MacIntel' })
    vi.stubGlobal('AudioContext', audioContextReporting({ maxChannelCount: 6 }))

    const platform = browserPlaybackPlatform(document.createElement('video'))

    await expect(platform.audioOutputChannels()).resolves.toBe(6)
  })

  it('shouldAnswerOnlyAfterTheAudioContextClosesWhenReadingTheOutput', async () => {
    let finishClosing = () => {}
    const closed = new Promise<void>((resolve) => {
      finishClosing = resolve
    })
    vi.stubGlobal('navigator', { userAgent: SAFARI, platform: 'MacIntel' })
    vi.stubGlobal('AudioContext', audioContextReporting({ maxChannelCount: 6, closed }))
    const platform = browserPlaybackPlatform(document.createElement('video'))
    const settled: string[] = []
    void closed.then(() => settled.push('closed'))

    const reading = platform.audioOutputChannels().then((channels) => {
      settled.push(`answered ${channels}`)
    })
    finishClosing()
    await reading

    expect(settled).toEqual(['closed', 'answered 6'])
  })

  it('shouldAnswerNoChannelsWhenWebKitRunsOnLinuxEvenWhenItsOutputPlaysSurround', async () => {
    vi.stubGlobal('navigator', { userAgent: SAFARI, platform: 'Linux x86_64' })
    vi.stubGlobal('AudioContext', audioContextReporting({ maxChannelCount: 6 }))

    const platform = browserPlaybackPlatform(document.createElement('video'))

    await expect(platform.audioOutputChannels()).resolves.toBe(0)
  })

  // Chrome's user agent names AppleWebKit too, and Android reports a Linux platform.
  it.each([
    ['Firefox', FIREFOX, 'Linux x86_64'],
    ['Chrome', LINUX_CHROME, 'Linux x86_64'],
    ['ChromeOnAndroid', ANDROID_CHROME, 'Linux armv81'],
  ])(
    'shouldAnswerTheDefaultOutputsChannelMaximumWhen%sRunsOnLinux',
    async (_, userAgent, platformName) => {
      vi.stubGlobal('navigator', { userAgent, platform: platformName })
      vi.stubGlobal('AudioContext', audioContextReporting({ maxChannelCount: 6 }))

      const platform = browserPlaybackPlatform(document.createElement('video'))

      await expect(platform.audioOutputChannels()).resolves.toBe(6)
    },
  )

  it('shouldAnswerNoChannelsWhenTheBrowserOffersNoAudioContext', async () => {
    vi.stubGlobal('AudioContext', undefined)

    const platform = browserPlaybackPlatform(document.createElement('video'))

    await expect(platform.audioOutputChannels()).resolves.toBe(0)
  })

  it.each([
    ['TheDisplayIsHdr', '(dynamic-range: high)', true],
    ['OnlyTheVideoPlaneIsHdr', '(video-dynamic-range: high)', true],
    ['NeitherTheDisplayNorTheVideoPlaneIsHdr', '(prefers-reduced-motion: reduce)', false],
  ])(
    'shouldAnswerFromTheMediaQueriesWhetherTheDisplayShowsHdrWhen%s',
    (_, highQuery, displaysHighDynamicRange) => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === highQuery }))

      const platform = browserPlaybackPlatform(document.createElement('video'))

      expect(platform.displaysHighDynamicRange).toBe(displaysHighDynamicRange)
    },
  )

  it('shouldAnswerThatTheDisplayShowsNoHdrWhenTheBrowserOffersNoMatchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)

    const platform = browserPlaybackPlatform(document.createElement('video'))

    expect(platform.displaysHighDynamicRange).toBe(false)
  })

  it('shouldLeaveDecodingInfoAbsentWhenTheBrowserOffersNoMediaCapabilities', () => {
    vi.stubGlobal('navigator', { userAgent: SAFARI, platform: 'MacIntel' })

    const platform = browserPlaybackPlatform(document.createElement('video'))

    expect(platform.decodingInfo).toBeUndefined()
  })
})
