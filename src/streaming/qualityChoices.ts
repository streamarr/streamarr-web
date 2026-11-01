import type { VideoQuality } from '../graphql/generated/graphql'

/** The playback choices the server offers for the media title, in menu order, and the one playing. */
export interface QualityChoices {
  offered: readonly VideoQuality[]
  playing: VideoQuality
}

const QUALITY_LABELS = new Map<VideoQuality, string>([
  ['ORIGINAL', 'Original'],
  ['AUTO', 'Auto'],
  ['UHD_4K', '4K'],
  ['FULL_HD_1080P', '1080p'],
  ['HIGH_720P', '720p'],
  ['MEDIUM_480P', '480p'],
  ['LOW_360P', '360p'],
])

// Neither name says how large the picture is, so the quality chip adds the playing height.
const SIZELESS_CHOICES = new Set<VideoQuality>(['ORIGINAL', 'AUTO'])

/** The menu's name for a playback choice, or undefined for one the server added after this client. */
export function qualityLabel(choice: VideoQuality): string | undefined {
  return QUALITY_LABELS.get(choice)
}

/** What the quality chip shows for a playback choice playing at `videoHeight` pixels, 0 if unknown. */
export function qualityChipValue(choice: VideoQuality, videoHeight: number): string | undefined {
  const label = qualityLabel(choice)
  if (!label || videoHeight <= 0 || !SIZELESS_CHOICES.has(choice)) {
    return label
  }
  return `${label} · ${videoHeight}p`
}
