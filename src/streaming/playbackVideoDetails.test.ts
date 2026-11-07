import { describe, expect, it } from 'vitest'
import { playbackDecision } from '../test/playbackSession'
import { videoRows } from './playbackDecisionText'
import { videoFormatDetails } from '../test/videoFormatDetails'

describe('playback video details', () => {
  it('should preserve unknown facts and zero light levels without inventing metadata', () => {
    const { video } = playbackDecision({ streamSessionId: 'stream-1' })
    const details = videoFormatDetails({
      codecProfile: '%future added value',
      dolbyVision: {
        presence: 'PRESENT',
        profile: 10,
        level: null,
        baseLayerCompatibilityId: 0,
        enhancementLayer: 'UNSPECIFIED',
        observedRpu: 'UNSPECIFIED',
      },
      contentLightLevel: { maxContentLightLevel: 0, maxFrameAverageLightLevel: 0 },
      bitstreamRewrites: ['%future added value'],
    })
    const rows = videoRows({
      ...video,
      source: { ...video.source, details },
      output: { ...video.output, details },
    })
    expect(rows.find((row) => row.name === 'Dolby Vision profile')?.original).toBe(
      '10.0 · level Unknown',
    )
    for (const name of [
      'Codec profile',
      'Codec level',
      'Bit depth',
      'Chroma',
      'HDR base',
      'HDR10+',
      'Enhancement layer',
      'MaxCLL',
      'MaxFALL',
      'Bitstream changes',
    ]) {
      expect(rows.find((row) => row.name === name)?.original).toBe('Unknown')
    }
  })

  it.each([
    ['PQ', 'ABSENT', 'PQ HDR'],
    ['PQ', 'PRESENT', 'HDR10+'],
    ['HLG', 'ABSENT', 'HLG'],
    ['SDR', 'ABSENT', 'SDR'],
    ['UNSPECIFIED', 'UNSPECIFIED', 'Unknown'],
  ] as const)(
    'should describe %s with HDR10+ %s without inferring the display mode',
    (compatibleBase, hdr10Plus, label) => {
      const { video } = playbackDecision({ streamSessionId: 'stream-1' })
      const details = videoFormatDetails({ compatibleBase, hdr10Plus })
      const rows = videoRows({
        ...video,
        source: { ...video.source, details },
        output: { ...video.output, details },
      })
      expect(rows.find((row) => row.name === 'HDR')?.original).toBe(label)
      expect(rows.find((row) => row.name === 'Bit depth')?.original).toBe('Unknown')
    },
  )

  it('should distinguish the original profile seven FEL from the delivered profile eight one', () => {
    const { video } = playbackDecision({ streamSessionId: 'stream-1' })
    const details = {
      codecProfile: 'HEVC_MAIN_10' as const,
      codecLevel: 51,
      bitDepth: 10,
      chromaSubsampling: 'CHROMA_420' as const,
      compatibleBase: 'PQ' as const,
      hdr10Plus: 'ABSENT' as const,
      dolbyVision: {
        presence: 'PRESENT' as const,
        profile: 7,
        level: 6,
        baseLayerCompatibilityId: 6,
        enhancementLayer: 'FEL' as const,
        observedRpu: 'PRESENT' as const,
      },
      masteringDisplay: { minLuminance: 0.0001, maxLuminance: 1000 },
      contentLightLevel: { maxContentLightLevel: 1032, maxFrameAverageLightLevel: 355 },
      bitstreamRewrites: [],
    }
    const rows = videoRows({
      ...video,
      source: { ...video.source, dolbyVision: true, details },
      output: {
        ...video.output,
        dolbyVision: true,
        details: {
          ...details,
          dolbyVision: {
            ...details.dolbyVision,
            profile: 8,
            baseLayerCompatibilityId: 1,
            enhancementLayer: 'NONE',
          },
          bitstreamRewrites: ['CONVERT_DOLBY_VISION_PROFILE_7_TO_8_1'],
        },
      },
    })

    expect(rows).toContainEqual({
      name: 'Dolby Vision profile',
      original: '7 · level 6',
      playing: '8.1 · level 6',
      changed: true,
    })
    expect(rows).toContainEqual({
      name: 'Enhancement layer',
      original: 'FEL',
      playing: 'None',
      changed: true,
    })
    expect(rows).toContainEqual({
      name: 'Bit depth',
      original: '10-bit',
      playing: '10-bit',
      changed: false,
    })
    expect(rows).toContainEqual({
      name: 'HDR base',
      original: 'PQ (ST 2084)',
      playing: 'PQ (ST 2084)',
      changed: false,
    })
    expect(rows).toContainEqual({
      name: 'Mastering display',
      original: '0.0001–1000 nits',
      playing: '0.0001–1000 nits',
      changed: false,
    })
    expect(rows.find((row) => row.name === 'Bitstream changes')?.playing).toBe(
      'Dolby Vision 7 → 8.1; enhancement layer removed',
    )
  })
})
