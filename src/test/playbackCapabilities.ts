import type { ClientCapabilityDeclarationInput } from '../graphql/generated/graphql'

/** What a browser declares when it cannot answer decodingInfo: full HD H.264 and stereo AAC. */
export const MINIMAL_DECLARATION: ClientCapabilityDeclarationInput = {
  video: [
    {
      codecFamily: 'H264',
      codecProfiles: [
        { profile: 'H264_HIGH', maxLevel: 40 },
        { profile: 'H264_MAIN', maxLevel: 40 },
        { profile: 'H264_CONSTRAINED_BASELINE', maxLevel: 40 },
      ],
      maxBitDepth: 8,
      maxWidth: 1920,
      maxHeight: 1080,
      maxFrameRate: 30,
      compatibleBases: ['SDR'],
      dolbyVisionProfiles: [],
      hdr10Plus: false,
      hls: true,
    },
  ],
  audio: [{ codec: 'AAC', maxChannels: 2, hls: true }],
}
