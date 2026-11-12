import { vi } from 'vitest'
import type { ClientCapabilityDeclarationInput } from '../graphql/generated/graphql'
import type { DecodingAnswer, PlaybackPlatform } from '../streaming/playbackCapabilities'

export const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

export const IPHONE_SAFARI_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1'

export const MAC_SAFARI_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15'

export const IPHONE_CHROME_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1'

export const FIREFOX_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0'

export type DecodingInfo = NonNullable<PlaybackPlatform['decodingInfo']>

/**
 * Replaces the navigator, for the rest of the test, with a browser of this user agent and platform.
 * Its MediaCapabilities answers through `decodingInfo`, and it has none without one.
 */
export function browseIn({
  userAgent,
  platform,
  decodingInfo,
}: {
  userAgent: string
  platform: string
  decodingInfo?: DecodingInfo
}): void {
  vi.stubGlobal('navigator', {
    userAgent,
    platform,
    ...(decodingInfo && { mediaCapabilities: { decodingInfo } }),
  })
}

/** What iPhone Safari answers for HEVC Main and Main 10 at every tier from 720p30 to 2160p60. */
export const IPHONE_SAFARI_HEVC_ANSWER: DecodingAnswer = {
  supported: true,
  smooth: false,
  powerEfficient: true,
}

/** Answers every configuration supported, but smooth and power-efficient only up to 1080p. */
export function smoothUpToFullHd(configuration: MediaDecodingConfiguration): DecodingAnswer {
  const smooth = (configuration.video?.height ?? 0) <= 1080
  return { supported: true, smooth, powerEfficient: smooth }
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
  selectsAudioTrackInDirectPlay: false,
}

/**
 * Desktop Chrome playing through hls.js to a 7.1 output and a 2560×1440 SDR display at 2×,
 * without decodingInfo unless the overrides supply it.
 */
export function playbackPlatformFixture(
  overrides: Partial<PlaybackPlatform> = {},
): PlaybackPlatform {
  return {
    hlsJsSupported: true,
    nativeHlsSupported: false,
    mediaSourceTypeSupported: () => false,
    canPlayType: () => '',
    userAgent: CHROME_USER_AGENT,
    audioOutputChannels: () => Promise.resolve(8),
    displaysHighDynamicRange: false,
    screen: { width: 2560, height: 1440, pixelRatio: 2 },
    selectsAudioTrackInDirectPlay: false,
    ...overrides,
  }
}
