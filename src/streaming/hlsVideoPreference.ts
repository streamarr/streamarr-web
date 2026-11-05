import type { VideoRange, VideoSelectionOption } from 'hls.js'
import type {
  ClientCapabilityDeclarationInput,
  DeclaredCompatibleBase,
  DolbyVisionProfile,
} from '../graphql/generated/graphql'

/** The picture the viewer asks for: HDR where the stream and the player allow it, or SDR. */
export type DynamicRangeChoice = 'HDR' | 'SDR'

const BASE_RANGES = new Map<DeclaredCompatibleBase, VideoRange>([
  ['PQ', 'PQ'],
  ['HLG', 'HLG'],
])

// The VIDEO-RANGE the server writes for each Dolby Vision copy: the base's range, and PQ for the
// profiles without a compatible base.
const DOLBY_VISION_RANGES = new Map<DolbyVisionProfile, VideoRange>([
  ['PROFILE_5', 'PQ'],
  ['PROFILE_8_1', 'PQ'],
  ['PROFILE_8_4', 'HLG'],
  ['PROFILE_10_0', 'PQ'],
  ['PROFILE_10_1', 'PQ'],
  ['PROFILE_10_4', 'HLG'],
])

// hls.js lists its ranges in this order and, preferring HDR, starts on the last one a variant has.
const RANGE_ORDER: readonly VideoRange[] = ['SDR', 'PQ', 'HLG']

/**
 * The hls.js video preference for a declaration and the viewer's choice. hls.js chooses a range
 * only once, when it starts, so a changed choice takes a new hls.js instance.
 */
export function hlsVideoPreference(
  declaration: ClientCapabilityDeclarationInput,
  choice: DynamicRangeChoice,
): VideoSelectionOption {
  const hdrRanges = declaredHlsRanges(declaration)
  if (choice === 'SDR' || hdrRanges.size === 0) {
    return { preferHDR: false, allowedVideoRanges: ['SDR'] }
  }
  return {
    preferHDR: true,
    allowedVideoRanges: RANGE_ORDER.filter((range) => range === 'SDR' || hdrRanges.has(range)),
  }
}

function declaredHlsRanges(declaration: ClientCapabilityDeclarationInput): Set<VideoRange> {
  const ranges = declaration.video
    .filter((entry) => entry.hls)
    .flatMap((entry) => [
      ...entry.compatibleBases.map((base) => BASE_RANGES.get(base)),
      ...entry.dolbyVisionProfiles.map(({ profile }) => DOLBY_VISION_RANGES.get(profile)),
    ])
  return new Set(ranges.filter((range) => range !== undefined))
}
