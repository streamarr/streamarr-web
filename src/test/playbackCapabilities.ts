import type { ClientCapabilityDeclarationInput } from '../graphql/generated/graphql'
import type { DecodingAnswer, PlaybackPlatform } from '../streaming/playbackCapabilities'

export const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

export const IPHONE_SAFARI_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1'

/** What iPhone Safari answers for HEVC Main and Main 10 at every tier from 720p30 to 2160p60. */
export const IPHONE_SAFARI_HEVC_ANSWER: DecodingAnswer = {
  supported: true,
  smooth: false,
  powerEfficient: true,
}

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

/** Desktop Chrome playing through hls.js, without decodingInfo unless the overrides supply it. */
export function playbackPlatformFixture(
  overrides: Partial<PlaybackPlatform> = {},
): PlaybackPlatform {
  return {
    hlsJsSupported: true,
    nativeHlsSupported: false,
    mediaSourceTypeSupported: () => false,
    canPlayType: () => '',
    userAgent: CHROME_USER_AGENT,
    ...overrides,
  }
}
