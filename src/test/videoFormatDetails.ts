import type { VideoFormatFieldsFragment } from '../graphql/generated/graphql'

type Details = NonNullable<VideoFormatFieldsFragment['details']>

export function videoFormatDetails(overrides: Partial<Details> = {}): Details {
  return {
    codecProfile: null,
    codecLevel: null,
    bitDepth: null,
    chromaSubsampling: null,
    compatibleBase: 'UNSPECIFIED',
    hdr10Plus: 'UNSPECIFIED',
    dolbyVision: {
      presence: 'UNSPECIFIED',
      profile: null,
      level: null,
      baseLayerCompatibilityId: null,
      enhancementLayer: null,
      observedRpu: null,
    },
    masteringDisplay: null,
    contentLightLevel: null,
    bitstreamRewrites: [],
    ...overrides,
  }
}
