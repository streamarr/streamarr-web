import type { VideoFormatFieldsFragment } from '../graphql/generated/graphql'
import type { TrackRow } from './playbackDecisionText'

type Details = NonNullable<VideoFormatFieldsFragment['details']>
const UNKNOWN = 'Unknown'
const PROFILES = new Set([
  'H264_CONSTRAINED_BASELINE',
  'H264_BASELINE',
  'H264_MAIN',
  'H264_EXTENDED',
  'H264_HIGH',
  'H264_HIGH_10',
  'H264_HIGH_422',
  'H264_HIGH_444_PREDICTIVE',
  'HEVC_MAIN',
  'HEVC_MAIN_10',
  'HEVC_MAIN_STILL_PICTURE',
  'HEVC_FORMAT_RANGE_EXTENSIONS',
  'AV1_MAIN',
  'AV1_HIGH',
  'AV1_PROFESSIONAL',
])

const BASES: Record<string, string> = { SDR: 'SDR', PQ: 'PQ (ST 2084)', HLG: 'HLG', NONE: 'None' }
const CHROMA: Record<string, string> = {
  CHROMA_420: '4:2:0',
  CHROMA_422: '4:2:2',
  CHROMA_444: '4:4:4',
  MONOCHROME: 'Monochrome',
}
const REWRITES: Record<string, string> = {
  CONVERT_DOLBY_VISION_PROFILE_7_TO_8_1: 'Dolby Vision 7 → 8.1; enhancement layer removed',
  STRIP_DOLBY_VISION: 'Dolby Vision removed',
  STRIP_HDR10_PLUS: 'HDR10+ removed',
  NORMALIZE_DOLBY_VISION_RECORD: 'Dolby Vision record normalized',
}

function named(names: Record<string, string>, value: string | null | undefined): string {
  return value && Object.hasOwn(names, value) ? names[value] : UNKNOWN
}

function presence(value: string | undefined): string {
  return named({ PRESENT: 'Present', ABSENT: 'Absent' }, value)
}

function profile(details: Details | null | undefined): string {
  const dolby = details?.dolbyVision
  if (dolby?.presence === 'ABSENT') return 'None'
  if (dolby?.presence !== 'PRESENT') return UNKNOWN
  const { profile, level, baseLayerCompatibilityId } = dolby
  if (profile === null) return UNKNOWN
  const suffix =
    (profile === 8 || profile === 10) && baseLayerCompatibilityId !== null
      ? `.${baseLayerCompatibilityId}`
      : ''
  return `${profile}${suffix} · level ${level ?? UNKNOWN}`
}

function mastering(details: Details | null | undefined): string {
  const display = details?.masteringDisplay
  return display ? `${display.minLuminance}–${display.maxLuminance} nits` : UNKNOWN
}

function light(value: number | null | undefined): string {
  return value ? `${value} nits` : UNKNOWN
}

export function detailedHdrText(details: Details): string {
  if (details.dolbyVision.presence === 'PRESENT') return 'Dolby Vision'
  if (details.hdr10Plus === 'PRESENT') return 'HDR10+'
  return named({ SDR: 'SDR', PQ: 'PQ HDR', HLG: 'HLG' }, details.compatibleBase)
}

/** Compare only facts the server supplies; these are not observations of the display. */
export function videoDetailsRows(
  source: VideoFormatFieldsFragment,
  output: VideoFormatFieldsFragment,
): TrackRow[] {
  if (!source.details && !output.details) return []
  const row = (name: string, text: (details: Details | null | undefined) => string): TrackRow => {
    const original = text(source.details)
    const playing = text(output.details)
    return { name, original, playing, changed: original !== playing }
  }
  const rows = [
    row('Codec profile', (details) =>
      details?.codecProfile && PROFILES.has(details.codecProfile)
        ? details.codecProfile.replaceAll('_', ' ')
        : UNKNOWN,
    ),
    row('Codec level', (details) =>
      details?.codecLevel == null ? UNKNOWN : String(details.codecLevel / 10),
    ),
    row('Bit depth', (details) =>
      details?.bitDepth == null ? UNKNOWN : `${details.bitDepth}-bit`,
    ),
    row('Chroma', (details) => named(CHROMA, details?.chromaSubsampling)),
    row('HDR base', (details) => named(BASES, details?.compatibleBase)),
    row('HDR10+', (details) => presence(details?.hdr10Plus)),
  ]
  if ([source, output].some((format) => format.details?.dolbyVision.presence === 'PRESENT')) {
    rows.push(
      row('Dolby Vision profile', profile),
      row('Enhancement layer', (details) => {
        if (details?.dolbyVision.presence === 'ABSENT') return 'None'
        return named(
          { NONE: 'None', MEL: 'MEL', FEL: 'FEL' },
          details?.dolbyVision.enhancementLayer,
        )
      }),
    )
  }
  if (source.details?.masteringDisplay || output.details?.masteringDisplay) {
    rows.push(row('Mastering display', mastering))
  }
  if (source.details?.contentLightLevel || output.details?.contentLightLevel) {
    rows.push(row('MaxCLL', (details) => light(details?.contentLightLevel?.maxContentLightLevel)))
    rows.push(
      row('MaxFALL', (details) => light(details?.contentLightLevel?.maxFrameAverageLightLevel)),
    )
  }
  if (output.details?.bitstreamRewrites.length) {
    rows.push(
      row('Bitstream changes', (details) =>
        details?.bitstreamRewrites.length
          ? details.bitstreamRewrites.map((rewrite) => named(REWRITES, rewrite)).join('; ')
          : 'None',
      ),
    )
  }
  return rows
}
