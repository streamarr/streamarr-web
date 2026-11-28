import type {
  ClientCapabilityDeclarationInput,
  DeclaredCompatibleBase,
  DolbyVisionProfile,
  VideoCapabilityEntryInput,
} from '../graphql/generated/graphql'
import { MINIMAL_DECLARATION } from '../test/playbackCapabilities'
import { describe, expect, it } from 'vitest'
import { hlsVideoPreference } from './hlsVideoPreference'

const [SDR_ENTRY] = MINIMAL_DECLARATION.video

function hdrEntry({
  compatibleBases = [],
  dolbyVisionProfiles = [],
  hls = true,
}: {
  compatibleBases?: DeclaredCompatibleBase[]
  dolbyVisionProfiles?: DolbyVisionProfile[]
  hls?: boolean
}): VideoCapabilityEntryInput {
  return {
    ...SDR_ENTRY,
    codecFamily: 'HEVC',
    codecProfiles: [{ profile: 'HEVC_MAIN_10', maxLevel: 51 }],
    maxBitDepth: 10,
    compatibleBases,
    dolbyVisionProfiles: dolbyVisionProfiles.map((profile) => ({ profile, maxLevel: 6 })),
    hls,
    directPlayContainers: hls ? [] : ['MP4'],
  }
}

function declaring(...entries: VideoCapabilityEntryInput[]): ClientCapabilityDeclarationInput {
  return { ...MINIMAL_DECLARATION, video: [SDR_ENTRY, ...entries] }
}

describe('hlsVideoPreference', () => {
  it('shouldPreferTheDeclaredHdrRangesWhenTheViewerChoosesHdr', () => {
    const declaration = declaring(hdrEntry({ compatibleBases: ['PQ', 'HLG'] }))

    expect(hlsVideoPreference(declaration, 'HDR')).toEqual({
      preferHDR: true,
      allowedVideoRanges: ['SDR', 'PQ', 'HLG'],
    })
  })

  it('shouldAllowOnlySdrWhenTheViewerChoosesSdr', () => {
    const declaration = declaring(hdrEntry({ compatibleBases: ['PQ', 'HLG'] }))

    expect(hlsVideoPreference(declaration, 'SDR')).toEqual({
      preferHDR: false,
      allowedVideoRanges: ['SDR'],
    })
  })

  it('shouldAllowOnlySdrWhenTheDeclarationListsNoHdrRange', () => {
    expect(hlsVideoPreference(MINIMAL_DECLARATION, 'HDR')).toEqual({
      preferHDR: false,
      allowedVideoRanges: ['SDR'],
    })
  })

  it('shouldAllowTheRangeADolbyVisionStreamCarriesWhenTheEntryListsItsProfile', () => {
    const declaration = declaring(
      hdrEntry({ dolbyVisionProfiles: ['PROFILE_5'] }),
      hdrEntry({ compatibleBases: ['HLG'], dolbyVisionProfiles: ['PROFILE_8_4'] }),
    )

    expect(hlsVideoPreference(declaration, 'HDR')).toEqual({
      preferHDR: true,
      allowedVideoRanges: ['SDR', 'PQ', 'HLG'],
    })
  })

  it('shouldMapEveryDolbyVisionProfileToTheRangeItsHlsVariantNames', () => {
    const rangeOf = (profile: DolbyVisionProfile) =>
      hlsVideoPreference(declaring(hdrEntry({ dolbyVisionProfiles: [profile] })), 'HDR')
        .allowedVideoRanges

    expect({
      PROFILE_5: rangeOf('PROFILE_5'),
      PROFILE_8_1: rangeOf('PROFILE_8_1'),
      PROFILE_8_4: rangeOf('PROFILE_8_4'),
      PROFILE_10_0: rangeOf('PROFILE_10_0'),
      PROFILE_10_1: rangeOf('PROFILE_10_1'),
      PROFILE_10_4: rangeOf('PROFILE_10_4'),
    }).toEqual({
      PROFILE_5: ['SDR', 'PQ'],
      PROFILE_8_1: ['SDR', 'PQ'],
      PROFILE_8_4: ['SDR', 'HLG'],
      PROFILE_10_0: ['SDR', 'PQ'],
      PROFILE_10_1: ['SDR', 'PQ'],
      PROFILE_10_4: ['SDR', 'HLG'],
    })
  })

  it('shouldIgnoreAnHdrRangeThatOnlyADirectPlayEntryDeclaresWhenHlsJsPlaysTheStream', () => {
    const declaration = declaring(hdrEntry({ compatibleBases: ['PQ'], hls: false }))

    expect(hlsVideoPreference(declaration, 'HDR')).toEqual({
      preferHDR: false,
      allowedVideoRanges: ['SDR'],
    })
  })
})
