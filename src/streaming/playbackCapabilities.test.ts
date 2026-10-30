import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AudioCapabilityEntryInput,
  ClientCapabilityDeclarationInput,
  VideoCapabilityEntryInput,
} from '../graphql/generated/graphql'
import { MINIMAL_DECLARATION, playbackPlatformFixture } from '../test/playbackCapabilities'
import { declarePlaybackCapabilities, type PlaybackPlatform } from './playbackCapabilities'

const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1'
const FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0'

const AV1_PROBE = 'video/mp4; codecs="av01.0.08M.08"'

type Decodes = (configuration: MediaDecodingConfiguration) => boolean

function codecOf(configuration: MediaDecodingConfiguration): string {
  const contentType = configuration.video?.contentType ?? configuration.audio?.contentType ?? ''
  return /codecs="([^"]+)"/.exec(contentType)?.[1] ?? ''
}

function decodingInfoAnswering(decodes: Decodes, isSmooth: Decodes = () => true) {
  return vi.fn((configuration: MediaDecodingConfiguration) => {
    const supported = decodes(configuration)
    return Promise.resolve({ supported, smooth: supported && isSmooth(configuration) })
  })
}

function isFullHdAtThirtyFrames(configuration: MediaDecodingConfiguration): boolean {
  return configuration.video?.width === 1920 && configuration.video.framerate === 30
}

// Main-tier maximum bitrates in bits per second, keyed by the level each codec string carries:
// H.265 Table A.8 (MaxBR × CpbVclFactor 1000), AV1 Annex A.3 (MainMbps), and WebKit's AV1 table,
// which counts a megabit as 2^20 bits and refuses a configuration above it before asking the
// decoder (WebCore AV1Utilities.cpp).
const HEVC_MAIN_TIER_BITRATES: Record<string, number> = {
  L93: 10_000_000,
  L120: 12_000_000,
  L123: 20_000_000,
  L150: 25_000_000,
  L153: 40_000_000,
}
const AV1_MAIN_TIER_BITRATES: Record<string, number> = {
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

function isWithinMainTierBitrate(
  configuration: MediaDecodingConfiguration,
  bitrates: Record<string, number>,
): boolean {
  const level = codecOf(configuration)
    .split('.')
    .find((part) => part in bitrates)
  if (level === undefined) {
    throw new Error(`No main-tier bitrate for ${codecOf(configuration)}`)
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

function decodesAudioUpTo(channels: number): Decodes {
  return (configuration) =>
    configuration.audio === undefined || Number(configuration.audio.channels) <= channels
}

function answer(supported: boolean) {
  return { supported, smooth: supported }
}

const NEVER_ANSWERED = new Promise<{ supported: boolean; smooth: boolean }>(() => {})

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

describe('declarePlaybackCapabilities', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldDeclareOneEntryPerFamilyWhenTheBrowserDecodesEveryTier', async () => {
    const declaration = await declarePlaybackCapabilities(platformFixture())

    expect(declaration.video).toEqual([
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
    ])
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
            isWithinMainTierBitrate(configuration, WEBKIT_AV1_MAIN_TIER_BITRATES),
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

  it('shouldProbeEachHevcAndAv1TierWithinItsLevelsMainTierBitrate', async () => {
    const decodingInfo = decodingInfoAnswering(() => true)

    await declarePlaybackCapabilities(platformFixture({ decodingInfo }))

    const probes = decodingInfo.mock.calls.map(([configuration]) => configuration)
    const hevcProbes = probes.filter((probe) => codecOf(probe).startsWith('hvc1'))
    const av1Probes = probes.filter((probe) => codecOf(probe).startsWith('av01'))
    expect(hevcProbes).not.toEqual([])
    expect(av1Probes).not.toEqual([])
    expect(
      hevcProbes.filter((probe) => !isWithinMainTierBitrate(probe, HEVC_MAIN_TIER_BITRATES)),
    ).toEqual([])
    expect(
      av1Probes.filter((probe) => !isWithinMainTierBitrate(probe, AV1_MAIN_TIER_BITRATES)),
    ).toEqual([])
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
          decodesOnly(['avc1.64002A', 'hvc1.1.6.L123.B0', 'av01.0.09M.08', 'mp4a.40.2']),
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
    const decodingInfo = decodingInfoAnswering(
      (configuration) => !codecOf(configuration).startsWith('av01'),
    )
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo,
        hlsJsSupported: false,
        nativeHlsSupported: true,
        canPlayType: (type) => (type === AV1_PROBE ? 'probably' : ''),
        userAgent: SAFARI,
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toHaveLength(1)
  })

  it('shouldDropAv1WhenNothingCorroboratesAFalseDecodingAnswer', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(
          (configuration) => !codecOf(configuration).startsWith('av01'),
        ),
        canPlayType: (type) => (type === AV1_PROBE ? 'probably' : ''),
      }),
    )

    expect(familyEntries(declaration, 'AV1')).toEqual([])
  })

  it('shouldAskAboutMediaSourcePlaybackWhenHlsJsPlays', async () => {
    const decodingInfo = decodingInfoAnswering(() => true)

    await declarePlaybackCapabilities(platformFixture({ decodingInfo }))

    expect(new Set(decodingInfo.mock.calls.map(([configuration]) => configuration.type))).toEqual(
      new Set(['media-source']),
    )
  })

  it('shouldAskAboutFilePlaybackWhenOnlyNativeHlsPlays', async () => {
    const decodingInfo = decodingInfoAnswering(() => true)

    await declarePlaybackCapabilities(
      platformFixture({ decodingInfo, hlsJsSupported: false, nativeHlsSupported: true }),
    )

    expect(new Set(decodingInfo.mock.calls.map(([configuration]) => configuration.type))).toEqual(
      new Set(['file']),
    )
  })

  it('shouldApplyNoVideoEntryToHlsWhenTheBrowserPlaysNoHls', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({ hlsJsSupported: false, nativeHlsSupported: false }),
    )

    expect(declaration.video.map((entry) => entry.hls)).toEqual([false, false, false])
    expect(audioEntry(declaration, 'AAC')?.hls).toBe(true)
  })

  it('shouldDeclareStereoAacForHlsWhenTheBrowserDecodesNoAudio', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering((configuration) => configuration.audio === undefined),
      }),
    )

    expect(declaration.audio).toEqual([{ codec: 'AAC', maxChannels: 2, hls: true }])
  })

  it('shouldDeclareEveryAudioCodecThatDecodesWhenTheBrowserConfirmsSurround', async () => {
    const declaration = await declarePlaybackCapabilities(platformFixture())

    expect(declaration.audio).toEqual([
      { codec: 'AAC', maxChannels: 6, hls: true },
      { codec: 'AC3', maxChannels: 6, hls: true },
      { codec: 'EAC3', maxChannels: 6, hls: true },
      { codec: 'OPUS', maxChannels: 6, hls: true },
      { codec: 'FLAC', maxChannels: 6, hls: true },
      { codec: 'ALAC', maxChannels: 6, hls: true },
    ])
  })

  it('shouldDeclareStereoWhenTheBrowserConfirmsOnlyStereo', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(decodesAudioUpTo(2)),
      }),
    )

    expect(declaration.audio.map((entry) => entry.maxChannels)).toEqual([2, 2, 2, 2, 2, 2])
  })

  it('shouldDeclareAtMostSixChannelsWhenFirefoxConfirmsMore', async () => {
    const declaration = await declarePlaybackCapabilities(
      platformFixture({
        decodingInfo: decodingInfoAnswering(decodesAudioUpTo(8)),
        userAgent: FIREFOX,
      }),
    )

    expect(Math.max(...declaration.audio.map((entry) => entry.maxChannels))).toBe(6)
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

  it('shouldDeclareTheLowestUnrefusedH264TierWhenTheBrowserRefusesEveryAnsweredH264Tier', async () => {
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

    expect(familyEntries(await declaration, 'H264')).toEqual([
      sdrVideoEntry({ codecProfiles: h264Profiles(31), maxWidth: 1280, maxHeight: 720 }),
    ])
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
})
