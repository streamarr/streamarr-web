import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientCapabilityDeclarationInput, VideoCodecTier } from '../graphql/generated/graphql'
import { IPHONE_SAFARI_USER_AGENT, playbackPlatformFixture } from '../test/playbackCapabilities'
import { declarePlaybackCapabilities, type DecodingAnswer } from './playbackCapabilities'

function answer(supported: boolean, smooth = supported) {
  return { supported, smooth, powerEfficient: supported }
}

function entriesAtTier(declaration: ClientCapabilityDeclarationInput, tier: VideoCodecTier) {
  return declaration.video.filter(
    (entry) =>
      entry.codecFamily === 'HEVC' &&
      entry.codecProfiles.some((profile) => profile.maxTier === tier),
  )
}

describe('HEVC capability declarations', () => {
  afterEach(() => vi.useRealTimers())
  it('shouldDeclareHighTierAndHigherLevelsWithoutIncreasingThePictureWhenSupported', async () => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        displaysHighDynamicRange: true,
        decodingInfo: () =>
          Promise.resolve({ supported: true, smooth: true, powerEfficient: true }),
      }),
    )

    expect(declaration.video).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codecFamily: 'HEVC',
          codecProfiles: [{ profile: 'HEVC_MAIN_10', maxLevel: 62, maxTier: 'HIGH' }],
          maxBitDepth: 10,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 60,
          compatibleBases: ['PQ', 'HLG'],
          dolbyVisionProfiles: [],
          hls: true,
        }),
      ]),
    )
  })

  it('shouldBoundHighTierByMainTierForEachProfileAndHdrBase', async () => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        displaysHighDynamicRange: true,
        decodingInfo: ({ video }) => {
          const mainTierLevel = /\.L(\d+)\./.exec(video?.contentType ?? '')?.[1]
          const ceiling = video?.transferFunction === 'pq' ? 150 : 153
          return Promise.resolve(answer(!mainTierLevel || Number(mainTierLevel) <= ceiling))
        },
      }),
    )
    const highTier = declaration.video.filter((entry) =>
      entry.codecProfiles.some((profile) => profile.maxTier === 'HIGH'),
    )
    expect(highTier.length).toBeGreaterThan(0)
    for (const entry of highTier) {
      const ceiling = entry.compatibleBases.includes('PQ') ? 50 : 51
      expect(entry.codecProfiles.every((profile) => profile.maxLevel <= ceiling)).toBe(true)
    }
  })

  it('shouldBoundEachHighTierProfileByItsOwnMainTierLevel', async () => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        decodingInfo: ({ video }) => {
          const codec = video?.contentType ?? ''
          const mainTierLevel = /\.L(\d+)\./.exec(codec)?.[1]
          const ceiling = codec.includes('hvc1.1') ? 186 : 153
          return Promise.resolve(answer(!mainTierLevel || Number(mainTierLevel) <= ceiling))
        },
      }),
    )
    expect(entriesAtTier(declaration, 'HIGH').map(({ codecProfiles }) => codecProfiles)).toEqual([
      [{ profile: 'HEVC_MAIN', maxLevel: 62, maxTier: 'HIGH' }],
      [
        { profile: 'HEVC_MAIN', maxLevel: 51, maxTier: 'HIGH' },
        { profile: 'HEVC_MAIN_10', maxLevel: 51, maxTier: 'HIGH' },
      ],
    ])
  })

  it('shouldUseSafarisExistingPowerEfficientPictureBudgetForHighTier', async () => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        userAgent: IPHONE_SAFARI_USER_AGENT,
        decodingInfo: ({ video }) => {
          if (video?.contentType.includes('hvc1')) {
            return Promise.resolve(answer(true, false))
          }
          return Promise.resolve(answer(true, (video?.width ?? 0) <= 1920))
        },
      }),
    )
    expect(declaration.video).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codecFamily: 'HEVC',
          codecProfiles: [
            { profile: 'HEVC_MAIN', maxLevel: 62, maxTier: 'HIGH' },
            { profile: 'HEVC_MAIN_10', maxLevel: 62, maxTier: 'HIGH' },
          ],
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 60,
        }),
      ]),
    )
  })

  it.each(['high-tier', 'higher-level', 'main-tier'])(
    'shouldRequireFileSupportForTheDeclaredHevcMaximumWhenFileRefuses%s',
    async (refusal) => {
      const declaration = await declarePlaybackCapabilities(
        playbackPlatformFixture({
          displaysHighDynamicRange: true,
          canPlayType: () => 'probably',
          decodingInfo: ({ type, video }) => {
            const codec = video?.contentType ?? ''
            const refused = {
              'high-tier': /\.H\d+\./.test(codec),
              'higher-level': /\.[LH]186\./.test(codec),
              'main-tier': /\.L186\./.test(codec),
            }[refusal]
            return Promise.resolve(answer(type !== 'file' || !refused))
          },
        }),
      )
      const highTier = declaration.video.filter((entry) =>
        entry.codecProfiles.some((profile) => profile.maxTier === 'HIGH'),
      )
      expect(highTier.length).toBeGreaterThan(0)
      expect(highTier.every((entry) => entry.hls && !entry.directPlayContainers?.length)).toBe(true)
    },
  )

  it.each([52, 60, 61, 62])(
    'shouldDeclareHighTierLevel%iOnlyWhenAnsweredSupported',
    async (level) => {
      const declaration = await declarePlaybackCapabilities(
        playbackPlatformFixture({
          decodingInfo: ({ video }) => {
            const highLevel = /\.H(\d+)\./.exec(video?.contentType ?? '')?.[1]
            return Promise.resolve(answer(!highLevel || Number(highLevel) <= level * 3))
          },
        }),
      )
      expect(entriesAtTier(declaration, 'HIGH')).toEqual([
        expect.objectContaining({
          codecProfiles: [
            { profile: 'HEVC_MAIN', maxLevel: level, maxTier: 'HIGH' },
            { profile: 'HEVC_MAIN_10', maxLevel: level, maxTier: 'HIGH' },
          ],
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 60,
        }),
      ])
      expect(entriesAtTier(declaration, 'MAIN')[0].codecProfiles[0].maxLevel).toBe(62)
    },
  )

  it('shouldKeepEachProfilesIndependentlySupportedLevel', async () => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        decodingInfo: ({ video }) => {
          const codec = video?.contentType ?? ''
          const level = /\.H(\d+)\./.exec(codec)?.[1]
          const ceiling = codec.includes('hvc1.1') ? 156 : 183
          return Promise.resolve(answer(!level || Number(level) <= ceiling))
        },
      }),
    )
    expect(entriesAtTier(declaration, 'HIGH').map(({ codecProfiles }) => codecProfiles)).toEqual([
      [{ profile: 'HEVC_MAIN_10', maxLevel: 61, maxTier: 'HIGH' }],
      [
        { profile: 'HEVC_MAIN', maxLevel: 52, maxTier: 'HIGH' },
        { profile: 'HEVC_MAIN_10', maxLevel: 52, maxTier: 'HIGH' },
      ],
    ])
  })

  it.each(['L', 'H'])('shouldNotDeclareAMaximumOverARefusedLowerLevelAtTier%s', async (tier) => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        decodingInfo: ({ video }) =>
          Promise.resolve(answer(!video?.contentType.includes(`.${tier}153.`))),
      }),
    )
    const entries = entriesAtTier(declaration, tier === 'L' ? 'MAIN' : 'HIGH')
    expect(entries).toHaveLength(2)
    expect(entries.map(({ maxHeight, maxFrameRate }) => [maxHeight, maxFrameRate])).toEqual([
      [2160, 30],
      [1080, 60],
    ])
    expect(
      entries.every(({ codecProfiles }) => codecProfiles.every(({ maxLevel }) => maxLevel === 50)),
    ).toBe(true)
    expect(
      entriesAtTier(declaration, 'HIGH').every(({ codecProfiles }) =>
        codecProfiles.every(({ maxLevel }) => maxLevel <= 50),
      ),
    ).toBe(true)
  })

  it('shouldKeepHdrBasesAtTheirOwnHighTierCeilings', async () => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        displaysHighDynamicRange: true,
        decodingInfo: ({ video }) => {
          const level = /\.H(\d+)\./.exec(video?.contentType ?? '')?.[1]
          const ceiling = video?.transferFunction === 'pq' ? 150 : 156
          return Promise.resolve(answer(!level || Number(level) <= ceiling))
        },
      }),
    )
    const hdr = entriesAtTier(declaration, 'HIGH').filter(
      ({ compatibleBases }) => !compatibleBases.includes('SDR'),
    )
    expect(hdr).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codecProfiles: [{ profile: 'HEVC_MAIN_10', maxLevel: 52, maxTier: 'HIGH' }],
          compatibleBases: ['HLG'],
          maxWidth: 3840,
          maxFrameRate: 60,
        }),
        expect.objectContaining({
          codecProfiles: [{ profile: 'HEVC_MAIN_10', maxLevel: 50, maxTier: 'HIGH' }],
          compatibleBases: ['PQ', 'HLG'],
          maxWidth: 3840,
          maxFrameRate: 30,
        }),
      ]),
    )
    expect(
      hdr
        .filter(({ compatibleBases }) => compatibleBases.includes('PQ'))
        .every(({ codecProfiles }) => codecProfiles[0].maxLevel === 50),
    ).toBe(true)
  })

  it.each(['reject', 'timeout'])(
    'shouldKeepMeasuredLowerLevelsWhenHigherProbes%s',
    async (missing) => {
      vi.useFakeTimers()
      const pending = new Promise<DecodingAnswer>(() => {})
      const declaration = declarePlaybackCapabilities(
        playbackPlatformFixture({
          decodingInfo: ({ video }) => {
            const level = /\.[LH](\d+)\./.exec(video?.contentType ?? '')?.[1]
            if (level && Number(level) > 153) {
              return missing === 'reject' ? Promise.reject(new Error('Unavailable')) : pending
            }
            return Promise.resolve(answer(true))
          },
        }),
      )
      await vi.advanceTimersByTimeAsync(3000)
      const measured = await declaration
      expect(entriesAtTier(measured, 'MAIN')[0].codecProfiles[0].maxLevel).toBe(51)
      expect(entriesAtTier(measured, 'HIGH')[0].codecProfiles[0].maxLevel).toBe(51)
    },
  )

  it('shouldNotInferHighTierFromMainTierWhenHighTierGoesUnanswered', async () => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        decodingInfo: ({ video }) =>
          /\.H\d+\./.test(video?.contentType ?? '')
            ? Promise.reject(new Error('Unavailable'))
            : Promise.resolve(answer(true)),
      }),
    )
    expect(entriesAtTier(declaration, 'HIGH')).toEqual([])
    expect(entriesAtTier(declaration, 'MAIN')[0].codecProfiles[0].maxLevel).toBe(62)
  })

  it('shouldNotUsePowerEfficiencyAboveASmoothHighTierCeilingOnSafari', async () => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        userAgent: IPHONE_SAFARI_USER_AGENT,
        decodingInfo: ({ video }) => {
          const level = /\.H(\d+)\./.exec(video?.contentType ?? '')?.[1]
          return Promise.resolve(answer(true, !level || Number(level) <= 156))
        },
      }),
    )
    expect(entriesAtTier(declaration, 'HIGH')[0].codecProfiles[0].maxLevel).toBe(52)
  })

  it.each([true, false])(
    'shouldDeclareHighTierDirectPlayOnlyWithMatchingFileSupportWhenHlsJsIs%s',
    async (hlsJsSupported) => {
      const declaration = await declarePlaybackCapabilities(
        playbackPlatformFixture({
          hlsJsSupported,
          nativeHlsSupported: true,
          canPlayType: (type) => (type.includes('hvc1') ? 'probably' : ''),
          decodingInfo: () => Promise.resolve(answer(true)),
        }),
      )
      expect(entriesAtTier(declaration, 'HIGH')).toEqual([
        expect.objectContaining({
          codecProfiles: [
            { profile: 'HEVC_MAIN', maxLevel: 62, maxTier: 'HIGH' },
            { profile: 'HEVC_MAIN_10', maxLevel: 62, maxTier: 'HIGH' },
          ],
          hls: true,
          directPlayContainers: ['MP4'],
          directPlaySampleEntries: ['HVC1'],
        }),
      ])
    },
  )

  it('shouldKeepDolbyVisionAtItsMeasuredTierAndLevel', async () => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        displaysHighDynamicRange: true,
        decodingInfo: () => Promise.resolve(answer(true)),
      }),
    )
    const dolbyVision = declaration.video.filter(
      ({ codecFamily, dolbyVisionProfiles }) =>
        codecFamily === 'HEVC' && dolbyVisionProfiles.length > 0,
    )
    expect(dolbyVision).toEqual([
      expect.objectContaining({
        codecProfiles: [{ profile: 'HEVC_MAIN_10', maxLevel: 51, maxTier: 'MAIN' }],
        dolbyVisionProfiles: [
          { profile: 'PROFILE_5', maxLevel: 9 },
          { profile: 'PROFILE_8_1', maxLevel: 9 },
          { profile: 'PROFILE_8_4', maxLevel: 9 },
        ],
      }),
    ])
    expect(
      entriesAtTier(declaration, 'HIGH').every(
        ({ dolbyVisionProfiles }) => dolbyVisionProfiles.length === 0,
      ),
    ).toBe(true)
  })

  it('shouldStayWithinTheContractsEntryLimitWhenLevelAndPictureCeilingsCross', async () => {
    const declaration = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        displaysHighDynamicRange: true,
        canPlayType: () => 'probably',
        decodingInfo: ({ video }) => {
          const level = /\.[LH](\d+)\./.exec(video?.contentType ?? '')?.[1]
          if (!video || !level) {
            return Promise.resolve(answer(true))
          }
          const levels =
            video.contentType.includes('hvc1.1') || video.transferFunction === 'pq'
              ? [153, 156, 180, 183, 186]
              : [156, 180, 183, 186, 186]
          const picture = `${video.width}@${video.framerate}`
          const pictures = ['3840@60', '3840@30', '1920@60', '1920@30', '1280@30']
          return Promise.resolve(answer(Number(level) <= levels[pictures.indexOf(picture)]))
        },
      }),
    )
    expect(declaration.video.length).toBeLessThanOrEqual(32)
    expect(declaration.video.some(({ codecFamily, hls }) => codecFamily === 'H264' && hls)).toBe(
      true,
    )
  })
})
