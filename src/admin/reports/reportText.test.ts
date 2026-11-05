import { describe, expect, it } from 'vitest'
import type { AudioCodec } from '../../graphql/generated/graphql'
import { audioEntryText, displayText, instantText, videoEntryText } from './reportText'

const UHD_DISPLAY = {
  width: 3840,
  height: 2160,
  hdrMode: 'HDR10_PLUS',
  refreshRate: 59.94,
  dynamicRangeMatched: true,
  frameRateMatched: true,
} as const

const AV1_ENTRY: Parameters<typeof videoEntryText>[0] = {
  codecFamily: 'AV1',
  codecProfiles: [{ profile: 'AV1_MAIN', maxLevel: 60, maxTier: 'HIGH' }],
  maxBitDepth: 10,
  maxWidth: 7680,
  maxHeight: 4320,
  maxFrameRate: 23.976,
  compatibleBases: [],
  dolbyVisionProfiles: [{ profile: 'PROFILE_10_0', maxLevel: 9 }],
  hdr10Plus: true,
  hls: false,
  directPlayContainers: ['MATROSKA', 'MP4'],
  directPlaySampleEntries: [],
}

describe('reportText', () => {
  it.each([
    [true, true, 'matched'],
    [false, false, 'not matched'],
    [true, false, 'frame rate matched, dynamic range not matched'],
    [false, true, 'dynamic range matched, frame rate not matched'],
  ])(
    'shouldSayWhetherTheTvMatchedWhenFrameRateMatchedIs%sAndDynamicRangeMatchedIs%s',
    (frameRateMatched, dynamicRangeMatched, match) => {
      expect(displayText({ ...UHD_DISPLAY, frameRateMatched, dynamicRangeMatched })).toBe(
        `3840×2160 HDR10+ · 59.94 Hz (${match})`,
      )
    },
  )

  it.each([
    [
      { width: null, height: null, refreshRate: 59.94, dynamicRangeMatched: null },
      'HDR10+ · 59.94 Hz (frame rate matched)',
    ],
    [
      { hdrMode: null, frameRateMatched: null, dynamicRangeMatched: false },
      '3840×2160 · 59.94 Hz (dynamic range not matched)',
    ],
    [
      {
        width: null,
        height: null,
        hdrMode: null,
        refreshRate: null,
        frameRateMatched: null,
        dynamicRangeMatched: false,
      },
      'Unknown (dynamic range not matched)',
    ],
  ])('shouldLeaveOutEachFigureTheTvDidNotReportWhenItReports(%o)', (unknown, text) => {
    expect(displayText({ ...UHD_DISPLAY, ...unknown })).toBe(text)
  })

  it('shouldNameTheTierLevelAndDirectPlayOfAnEntryWithoutHlsOrABase', () => {
    expect(videoEntryText(AV1_ENTRY)).toBe(
      'AV1 · Main to level 6 (High tier) · up to 7680×4320 at 23.976 fps, 10-bit · Dolby Vision 10.0 to level 9 · HDR10+ · direct play from MKV, MP4',
    )
  })

  it('shouldNameAValueThisAppDoesNotKnowAsTheServerSentItWhenTheDeclarationHoldsOne', () => {
    expect(
      audioEntryText({
        // A codec newer than this app.
        codec: 'DTS' as AudioCodec,
        maxChannels: 8,
        hls: false,
        directPlayContainers: ['MATROSKA'],
      }),
    ).toBe('DTS · up to 7.1 · direct play from MKV')
  })

  it('shouldKeepTheServersTextWhenTheInstantIsNotOne', () => {
    expect(instantText('soon')).toBe('soon')
  })
})
