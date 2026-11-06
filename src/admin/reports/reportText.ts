import type { PlaybackReportQuery, SourceContainer } from '../../graphql/generated/graphql'
import { channelsText, containerText, UNKNOWN } from '../../streaming/playbackDecisionText'
import { hdrModeText } from '../../streaming/playerFigures'

type Report = NonNullable<PlaybackReportQuery['playbackReport']>
type Declaration = Report['capabilityDeclaration']
type VideoEntry = Declaration['video'][number]
type AudioEntry = Declaration['audio'][number]
type Display = NonNullable<Report['player']['display']>
type AudioOutput = NonNullable<Report['player']['audioOutput']>

const VIDEO_CODECS: Readonly<Record<string, string>> = { H264: 'H.264', HEVC: 'HEVC', AV1: 'AV1' }
const AUDIO_CODECS: Readonly<Record<string, string>> = {
  AAC: 'AAC',
  AC3: 'AC-3',
  EAC3: 'E-AC-3',
  ALAC: 'ALAC',
  FLAC: 'FLAC',
  OPUS: 'Opus',
}
// PQ, which HDR10 and PQ10 share, reads as HDR10.
const BASES: Readonly<Record<string, string>> = { SDR: 'SDR', PQ: 'HDR10', HLG: 'HLG' }

const decimals = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })
const timestamps = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** When a report was shared or read, in the admin's own time zone. */
export function instantText(instant: string): string {
  const date = new Date(instant)
  return Number.isNaN(date.getTime()) ? instant : timestamps.format(date)
}

/**
 * One video capability entry of a client capability declaration, as one line: the codec family,
 * its profiles, the largest picture, the dynamic ranges and how the entry delivers.
 */
export function videoEntryText(entry: VideoEntry): string {
  const bases = entry.compatibleBases.map((base) => named(BASES, base))
  const dolbyVision = entry.dolbyVisionProfiles.map(
    ({ profile, maxLevel }) =>
      `Dolby Vision ${dolbyVisionProfileText(profile)} to level ${maxLevel}`,
  )
  return [
    named(VIDEO_CODECS, entry.codecFamily),
    entry.codecProfiles.map(codecProfileText).join(', '),
    `up to ${entry.maxWidth}×${entry.maxHeight} at ${decimals.format(entry.maxFrameRate)} fps, ${entry.maxBitDepth}-bit`,
    bases.join(', '),
    ...dolbyVision,
    entry.hdr10Plus ? 'HDR10+' : '',
    entry.hls ? 'HLS' : '',
    directPlayText(entry.directPlayContainers, entry.directPlaySampleEntries),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** One audio capability entry of a client capability declaration, as one line. */
export function audioEntryText(entry: AudioEntry): string {
  return [
    named(AUDIO_CODECS, entry.codec),
    `up to ${channelsText(entry.maxChannels)}`,
    entry.hls ? 'HLS' : '',
    directPlayText(entry.directPlayContainers, []),
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The display mode that a TV switched to, and whether it matched the content, leaving out each
 * figure that the TV did not report.
 */
export function displayText({
  width,
  height,
  hdrMode,
  refreshRate,
  dynamicRangeMatched,
  frameRateMatched,
}: Display): string {
  const size = width === null || height === null ? null : `${width}×${height}`
  const mode = [size, hdrMode && hdrModeText(hdrMode)].filter(Boolean).join(' ')
  const refresh = refreshRate === null ? null : `${decimals.format(refreshRate)} Hz`
  const shown = [mode, refresh].filter(Boolean).join(' · ') || UNKNOWN
  const match = matchText({ frameRateMatched, dynamicRangeMatched })
  return match ? `${shown} (${match})` : shown
}

/** Where a TV sends its audio, and how many channels that output accepts. */
export function audioOutputText({ route, channels }: AudioOutput): string {
  return `${route} · ${channels} channels`
}

function matchText({
  frameRateMatched,
  dynamicRangeMatched,
}: Pick<Display, 'frameRateMatched' | 'dynamicRangeMatched'>): string | null {
  if (frameRateMatched === null || dynamicRangeMatched === null) {
    return onlyMatchText({ frameRateMatched, dynamicRangeMatched })
  }
  if (frameRateMatched && dynamicRangeMatched) {
    return 'matched'
  }
  if (!frameRateMatched && !dynamicRangeMatched) {
    return 'not matched'
  }
  return frameRateMatched
    ? 'frame rate matched, dynamic range not matched'
    : 'dynamic range matched, frame rate not matched'
}

// What a TV reported of its match when it did not report both figures.
function onlyMatchText({
  frameRateMatched,
  dynamicRangeMatched,
}: Pick<Display, 'frameRateMatched' | 'dynamicRangeMatched'>): string | null {
  if (frameRateMatched !== null) {
    return frameRateMatched ? 'frame rate matched' : 'frame rate not matched'
  }
  if (dynamicRangeMatched !== null) {
    return dynamicRangeMatched ? 'dynamic range matched' : 'dynamic range not matched'
  }
  return null
}

function codecProfileText({ profile, maxLevel, maxTier }: VideoEntry['codecProfiles'][number]) {
  const tier = maxTier === 'HIGH' ? ' (High tier)' : ''
  // A level is written as the major level × 10 plus the minor level: 51 is level 5.1.
  return `${words(profile.replace(/^(H264|HEVC|AV1)_/, ''))} to level ${decimals.format(maxLevel / 10)}${tier}`
}

// PROFILE_8_1 is profile 8.1.
function dolbyVisionProfileText(profile: string): string {
  return profile.replace(/^PROFILE_/, '').replaceAll('_', '.')
}

function directPlayText(
  containers: readonly SourceContainer[],
  sampleEntries: readonly string[],
): string {
  if (containers.length === 0) {
    return ''
  }
  const from = `direct play from ${containers.map(containerText).join(', ')}`
  if (sampleEntries.length === 0) {
    return from
  }
  return `${from} as ${sampleEntries.map((entry) => entry.toLowerCase()).join(', ')}`
}

// MAIN_10 reads as Main 10.
function words(name: string): string {
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function named(table: Readonly<Record<string, string>>, value: string): string {
  return Object.hasOwn(table, value) ? table[value] : value
}
