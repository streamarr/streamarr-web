import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

// The synthetic HDR streams of record-safari-hdr.ts: four seconds of a 720p24 test pattern in HEVC
// Main 10, tagged BT.2020 with PQ or HLG. The Dolby Vision 8.1 stream is the HDR10 stream with a
// generated profile 8.1 RPU in every frame. Like the server's Dolby Vision copy, it keeps the hvc1
// sample entry without a Dolby Vision configuration record, and its playlist names Dolby Vision in
// SUPPLEMENTAL-CODECS.

export type HdrFixtureName = 'HDR10' | 'HLG' | 'DOLBY_VISION_8_1'

export interface HdrFixture {
  name: HdrFixtureName
  /** The multivariant playlist's VIDEO-RANGE. */
  videoRange: 'PQ' | 'HLG'
  /** The base layer's codec string, as CODECS names it. */
  codecs: string
  /** The Dolby Vision codec string and its compatibility brand, as SUPPLEMENTAL-CODECS names it. */
  supplementalCodecs?: string
}

const WIDTH = 1280
const HEIGHT = 720
const FRAME_RATE = 24
const SECONDS = 4
const SEGMENT_SECONDS = 2

// HEVC Main 10 at level 3.1. Dolby Vision level 01 covers 1280x720 at 24 frames per second.
const BASE_CODECS = 'hvc1.2.4.L93.B0'

export const HDR_FIXTURES: readonly HdrFixture[] = [
  { name: 'HDR10', videoRange: 'PQ', codecs: BASE_CODECS },
  { name: 'HLG', videoRange: 'HLG', codecs: BASE_CODECS },
  {
    name: 'DOLBY_VISION_8_1',
    videoRange: 'PQ',
    codecs: BASE_CODECS,
    supplementalCodecs: 'dvh1.08.01/db1p',
  },
]

/** The picture each fixture describes, for the decodingInfo questions about it. */
export const HDR_PICTURE = {
  width: WIDTH,
  height: HEIGHT,
  framerate: FRAME_RATE,
  bitrate: 5_000_000,
}

const COLOR = 'colorprim=bt2020:colormatrix=bt2020nc'
const PQ_PARAMETERS = [
  COLOR,
  'transfer=smpte2084:hdr10=1',
  'master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)',
  'max-cll=1000,400',
].join(':')
const HLG_PARAMETERS = `${COLOR}:transfer=arib-std-b67`

const run = promisify(execFile)

async function encodeHevc(x265Parameters: string, output: string): Promise<void> {
  const frames = FRAME_RATE * SEGMENT_SECONDS
  await run('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi'],
    ...['-i', `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FRAME_RATE}:duration=${SECONDS}`],
    ...['-pix_fmt', 'yuv420p10le', '-c:v', 'libx265'],
    ...[
      '-x265-params',
      `log-level=error:keyint=${frames}:min-keyint=${frames}:no-open-gop=1:${x265Parameters}`,
    ],
    ...['-f', 'hevc', output],
  ])
}

// dovi_tool generates one profile 8.1 RPU per frame and interleaves them into the HDR10 stream.
async function injectDolbyVision(directory: string, hdr10: string, output: string): Promise<void> {
  const config = join(directory, 'rpu.json')
  const rpu = join(directory, 'rpu.bin')
  await writeFile(
    config,
    JSON.stringify({
      cm_version: 'V40',
      length: FRAME_RATE * SECONDS,
      level6: {
        max_display_mastering_luminance: 1000,
        min_display_mastering_luminance: 1,
        max_content_light_level: 1000,
        max_frame_average_light_level: 400,
      },
    }),
  )
  await run('dovi_tool', ['generate', '-j', config, '-o', rpu])
  await run('dovi_tool', ['inject-rpu', '-i', hdr10, '--rpu-in', rpu, '-o', output])
}

// The HLS muxer writes zero-length segments from a raw HEVC stream, which carries no timestamps, so
// an MP4 holding the stream at the frame rate comes first.
async function writeMediaPlaylist(stream: string, directory: string): Promise<void> {
  const mp4 = join(directory, 'stream.mp4')
  await run('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FRAME_RATE)],
    ...['-i', stream, '-c', 'copy', '-tag:v', 'hvc1', mp4],
  ])
  await run('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-c', 'copy'],
    ...['-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod'],
    ...['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'],
    ...['-hls_segment_filename', join(directory, 'segment%d.m4s'), join(directory, 'stream.m3u8')],
  ])
  await rm(mp4)
}

/**
 * Writes the three fixtures under `directory`, each in its own directory named after it, as an
 * fMP4 media playlist stream.m3u8 with init.mp4 and segment0.m4s onwards. Needs FFmpeg with libx265
 * and dovi_tool.
 */
export async function writeHdrFixtures(directory: string): Promise<void> {
  const hdr10 = join(directory, 'hdr10.hevc')
  const hlg = join(directory, 'hlg.hevc')
  const dolbyVision = join(directory, 'dolby-vision-8-1.hevc')
  await encodeHevc(PQ_PARAMETERS, hdr10)
  await encodeHevc(HLG_PARAMETERS, hlg)
  await injectDolbyVision(directory, hdr10, dolbyVision)
  const streams: Record<HdrFixtureName, string> = {
    HDR10: hdr10,
    HLG: hlg,
    DOLBY_VISION_8_1: dolbyVision,
  }
  for (const { name } of HDR_FIXTURES) {
    await mkdir(join(directory, name))
    await writeMediaPlaylist(streams[name], join(directory, name))
  }
}

/** The fixture's multivariant playlist, as the server writes one for an HDR copy. */
export function hdrMultivariant({ codecs, supplementalCodecs, videoRange }: HdrFixture): string {
  const attributes = [
    'BANDWIDTH=3000000',
    `RESOLUTION=${WIDTH}x${HEIGHT}`,
    `FRAME-RATE=${FRAME_RATE}.000`,
    `CODECS="${codecs}"`,
    ...(supplementalCodecs ? [`SUPPLEMENTAL-CODECS="${supplementalCodecs}"`] : []),
    `VIDEO-RANGE=${videoRange}`,
  ]
  return ['#EXTM3U', `#EXT-X-STREAM-INF:${attributes.join(',')}`, 'stream.m3u8', ''].join('\n')
}

/** What Safari answered and played for one fixture. */
export interface HdrRecord {
  fixture: HdrFixtureName
  /** Each platform answer, keyed by the question. decodingInfo answers read as S, m and p flags. */
  answers: Record<string, string>
  hlsJs: Playback
  native: Playback
}

/** How one player played a fixture. */
export interface Playback {
  /** Whether the element played past the first segment without an error. */
  played: boolean
  /** The codec of the video SourceBuffer that hls.js created; null for the native player. */
  sourceBufferCodec: string | null
  /** The VIDEO-RANGE of the variant that hls.js chose; null for the native player. */
  videoRange: string | null
  /** The colour space of a decoded frame, read through VideoFrame, or null where it cannot be read. */
  frameColorSpace: { primaries: string | null; transfer: string | null } | null
  errors: string[]
}

/** The whole recording: the browser, its display, what the web client declares and each fixture. */
export interface SafariHdrRecording {
  userAgent: string
  displaysHighDynamicRange: boolean
  /** The web client's HEVC entries for HLS: their compatible bases and Dolby Vision profiles. */
  declaredHevc: { compatibleBases: string[]; dolbyVisionProfiles: string[] }[]
  fixtures: HdrRecord[]
}
