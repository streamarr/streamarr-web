import type { VideoQuality, VideoRange } from '../graphql/generated/graphql'
import type { DynamicRangeChoice } from './hlsVideoPreference'

const HDR_UNAVAILABLE = "HDR isn't available on this playback setup."
const ORIGINAL_PLAYS_AS_IT_IS = 'Original plays the video as it is.'

// Auto adapts by itself and Original plays the source as it is, so only a fixed quality takes the
// viewer's HDR choice (ADR 0013).
const CHOICES_WITHOUT_HDR_CHOICE = new Set<VideoQuality>(['AUTO', 'ORIGINAL'])

/** The dynamic ranges of the stream that plays, and whether this player can show HDR at all. */
export interface PlayingRanges {
  /** The playback choice that plays now. */
  choice: VideoQuality
  /** The source's range, or null while no decision names it. */
  source: VideoRange | null
  output: VideoRange
  declaresHdr: boolean
}

/** The HDR toggle's state; while unavailable it explains why, and the viewer cannot change it. */
export interface HdrControl {
  on: boolean
  unavailable?: string
}

/** Whether a playback choice takes the viewer's HDR choice. */
export function takesHdrChoice(choice: VideoQuality): boolean {
  return !CHOICES_WITHOUT_HDR_CHOICE.has(choice)
}

/**
 * The HDR toggle for an HDR source in a fixed quality or in Original, where it stays unavailable
 * because Original plays the source's own range (ADR 0013); none in Auto or for an SDR source.
 */
export function hdrControlFor(ranges: PlayingRanges): HdrControl | undefined {
  if (ranges.choice === 'AUTO' || !isHdr(ranges.source)) {
    return undefined
  }
  return { on: ranges.output !== 'SDR', unavailable: unavailability(ranges) }
}

// A setup that cannot show HDR explains itself first: no playback choice changes that.
function unavailability({ choice, declaresHdr }: PlayingRanges): string | undefined {
  if (!declaresHdr) {
    return HDR_UNAVAILABLE
  }
  return takesHdrChoice(choice) ? undefined : ORIGINAL_PLAYS_AS_IT_IS
}

/**
 * The HDR choice that a pick of `quality` asks for: for an HDR source in a fixed quality, the range
 * that plays now, so that the pick changes no picture, and SDR that Auto recovered to stays SDR.
 */
export function hdrChoiceFor(
  quality: VideoQuality,
  ranges: PlayingRanges | null,
): DynamicRangeChoice | undefined {
  if (!ranges || !takesHdrChoice(quality) || !isHdr(ranges.source)) {
    return undefined
  }
  return ranges.output === 'SDR' ? 'SDR' : 'HDR'
}

function isHdr(range: VideoRange | null): boolean {
  return range !== null && range !== 'SDR'
}
