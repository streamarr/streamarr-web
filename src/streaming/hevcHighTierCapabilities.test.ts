import { describe, expect, it } from 'vitest'
import { playbackPlatformFixture, IPHONE_SAFARI_USER_AGENT } from '../test/playbackCapabilities'
import { declarePlaybackCapabilities, type DecodingAnswer } from './playbackCapabilities'

const accepted: DecodingAnswer = { supported: true, smooth: true, powerEfficient: true }
const refused: DecodingAnswer = { supported: false, smooth: false, powerEfficient: false }

type Supports = (question: MediaDecodingConfiguration) => boolean

async function declaration(supports: Supports = () => true) {
  return declarePlaybackCapabilities(
    playbackPlatformFixture({
      displaysHighDynamicRange: true,
      canPlayType: () => 'probably',
      decodingInfo: (question) => Promise.resolve(supports(question) ? accepted : refused),
    }),
  )
}

function codec(question: MediaDecodingConfiguration) {
  return question.video?.contentType ?? ''
}

function isHigh(question: MediaDecodingConfiguration) {
  return /(?:hvc1|hev1)\.[12]\.[46]\.H/.test(codec(question))
}

function highEntries(result: Awaited<ReturnType<typeof declaration>>) {
  return result.video.filter(
    (entry) =>
      entry.codecFamily === 'HEVC' &&
      entry.codecProfiles.some((profile) => profile.maxTier === 'HIGH'),
  )
}

describe('HEVC High-tier declarations', () => {
  it('shouldKeepHighTierIndependentWhenSafariReportsSmoothMainTierAnswers', async () => {
    const result = await declarePlaybackCapabilities(
      playbackPlatformFixture({
        userAgent: IPHONE_SAFARI_USER_AGENT,
        decodingInfo: (question) =>
          Promise.resolve(
            isHigh(question) ? { supported: true, smooth: false, powerEfficient: true } : accepted,
          ),
      }),
    )
    expect(highEntries(result)).toHaveLength(1)
    expect(highEntries(result)[0]?.maxHeight).toBe(2160)
  })

  it('shouldDeclareHighTierSdrAndHdrWhenEachIsMeasuredAsSupported', async () => {
    const result = await declaration()
    expect(highEntries(result)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          compatibleBases: ['SDR'],
          maxWidth: 3840,
          maxFrameRate: 60,
          codecProfiles: [
            { profile: 'HEVC_MAIN', maxLevel: 51, maxTier: 'HIGH' },
            { profile: 'HEVC_MAIN_10', maxLevel: 51, maxTier: 'HIGH' },
          ],
        }),
        expect.objectContaining({
          compatibleBases: ['PQ', 'HLG'],
          codecProfiles: [{ profile: 'HEVC_MAIN_10', maxLevel: 51, maxTier: 'HIGH' }],
        }),
      ]),
    )
  })

  it('shouldRetainMainTierWhenTheBrowserRefusesHighTier', async () => {
    const result = await declaration((question) => !isHigh(question))
    expect(highEntries(result)).toEqual([])
    expect(
      result.video
        .filter((entry) => entry.codecFamily === 'HEVC')
        .flatMap((entry) => entry.codecProfiles),
    ).toContainEqual({ profile: 'HEVC_MAIN_10', maxLevel: 51, maxTier: 'MAIN' })
  })

  it('shouldDeclareOnlyMainHighTierWhenMain10HighTierIsRefused', async () => {
    const result = await declaration(
      (question) => !(isHigh(question) && codec(question).includes('.2.4.')),
    )
    expect(highEntries(result)).toHaveLength(1)
    expect(highEntries(result)[0]).toMatchObject({
      maxBitDepth: 8,
      codecProfiles: [{ profile: 'HEVC_MAIN', maxLevel: 51, maxTier: 'HIGH' }],
    })
  })

  it('shouldRetainAHigherMainTierCeilingWhenHighTierHasALowerCeiling', async () => {
    const result = await declaration(
      (question) => !isHigh(question) || (question.video?.height ?? 0) <= 1080,
    )
    expect(highEntries(result)).not.toHaveLength(0)
    expect(
      highEntries(result).every(
        (entry) =>
          entry.maxHeight === 1080 &&
          entry.codecProfiles.every((profile) => profile.maxLevel === 41),
      ),
    ).toBe(true)
  })

  it('shouldRefuseHighTierWhenItsMaximumWouldIncludeARefusedMainTier', async () => {
    const result = await declaration((question) => !codec(question).includes('.L120.'))
    expect(highEntries(result)).toEqual([])
  })

  it('shouldDeclareOnlyHighTierSdrWhenHighTierHdrIsRefused', async () => {
    const result = await declaration(
      (question) => !isHigh(question) || !question.video?.transferFunction,
    )
    expect(highEntries(result)).toHaveLength(1)
    expect(highEntries(result)[0]?.compatibleBases).toEqual(['SDR'])
  })

  it('shouldOmitHighTierDirectPlayWhenHighTierFileSupportIsRefused', async () => {
    const result = await declaration((question) => question.type !== 'file' || !isHigh(question))
    expect(highEntries(result)).not.toHaveLength(0)
    expect(highEntries(result).every((entry) => !entry.directPlayContainers?.length)).toBe(true)
  })

  it('shouldAskHighTierOnlyAtLevel4OrAboveWhenProbingHevc', async () => {
    const asked: string[] = []
    await declaration((question) => {
      asked.push(codec(question))
      return true
    })
    expect(asked.some((value) => value.includes('.H153.'))).toBe(true)
    expect(asked.some((value) => value.includes('.H93.'))).toBe(false)
  })
})
