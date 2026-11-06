import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

// The synthetic 7.1 stream of seven-one-channel-order.spec.ts and the rule that judges what a
// browser's audio graph read from it. After a second of silence, each channel in FFmpeg's 7.1
// order carries a tone for a second while the others are silent, and two seconds of silence end
// the stream. WebKit on Linux drops about the first second of audio and runs its graph up to a
// second behind the element, so the silence keeps every tone inside what the graph hears.

export const SEVEN_ONE_CHANNELS = [
  'front left',
  'front right',
  'centre',
  'LFE',
  'back left',
  'back right',
  'side left',
  'side right',
] as const

export type ChannelOrderCodec = 'AAC' | 'FLAC' | 'OPUS'

interface CodecFixture {
  /** The CODECS attribute value the multivariant playlist names. */
  codecs: string
  encoder: string[]
}

export const CODEC_FIXTURES: Record<ChannelOrderCodec, CodecFixture> = {
  AAC: { codecs: 'mp4a.40.2', encoder: ['-c:a', 'aac', '-b:a', '768k'] },
  FLAC: { codecs: 'fLaC', encoder: ['-c:a', 'flac'] },
  // FFmpeg's default Opus mapping moves 5.0 and 6.1 channels, so every server Opus encode above
  // two channels uses mapping family 1 (ADR 0043).
  OPUS: {
    codecs: 'Opus',
    encoder: ['-c:a', 'libopus', '-b:a', '768k', '-mapping_family', '1'],
  },
}

const LEAD_IN_SECONDS = 1
const LEAD_OUT_SECONDS = 2
/** How long the synthetic stream lasts. */
export const SEVEN_ONE_STREAM_SECONDS =
  LEAD_IN_SECONDS + SEVEN_ONE_CHANNELS.length + LEAD_OUT_SECONDS
const TONE_HZ = 1000
// Encoders low-pass the LFE channel.
const LFE_TONE_HZ = 50
const TONE_AMPLITUDE = 0.3

function toneExpressions(): string {
  return SEVEN_ONE_CHANNELS.map((channel, index) => {
    const hertz = channel === 'LFE' ? LFE_TONE_HZ : TONE_HZ
    const start = LEAD_IN_SECONDS + index
    return `if(between(t\\,${start}\\,${start + 1})\\,${TONE_AMPLITUDE}*sin(2*PI*${hertz}*t)\\,0)`
  }).join('|')
}

/**
 * Writes the synthetic 7.1 stream in `codec` to `directory` as an fMP4 media playlist,
 * stream.m3u8, with its init.mp4 and media segments segment0.m4s onwards. Needs FFmpeg with libopus.
 */
export async function writeSevenOneStream(
  codec: ChannelOrderCodec,
  directory: string,
): Promise<void> {
  const source = `aevalsrc=exprs=${toneExpressions()}:channel_layout=7.1:sample_rate=48000:duration=${SEVEN_ONE_STREAM_SECONDS}`
  await promisify(execFile)('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source],
    ...CODEC_FIXTURES[codec].encoder,
    ...['-f', 'hls', '-hls_time', '10', '-hls_playlist_type', 'vod'],
    ...['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'],
    ...['-hls_segment_filename', join(directory, 'segment%d.m4s'), join(directory, 'stream.m3u8')],
  ])
}

// A cross-origin element without CORS feeds Web Audio silence, so the page and the stream share
// the app's origin.
export const SEVEN_ONE_PAGE_PATH = '/seven-one-channel-order'
export const SEVEN_ONE_STREAM_PATH = '/seven-one-channel-order/stream'
/** A path under SEVEN_ONE_STREAM_PATH that names a file writeSevenOneStream writes. */
export const SEVEN_ONE_STREAM_FILE =
  /^\/seven-one-channel-order\/stream\/(stream\.m3u8|init\.mp4|segment\d+\.m4s)$/

/** The page, which Vite's dev server completes with e2e/sevenOneChannelOrderPage.ts. */
export const SEVEN_ONE_PAGE = [
  '<!doctype html><title>7.1 channel order</title>',
  '<video></video><button>Start</button>',
  '<script type="module" src="/e2e/sevenOneChannelOrderPage.ts"></script>',
].join('')

/** The multivariant playlist, whose CODECS attribute is `codecs`. */
export function sevenOneMultivariant(codecs: string): string {
  return [
    '#EXTM3U',
    `#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="${codecs}"`,
    'stream.m3u8',
    '',
  ].join('\n')
}

const RESULTS = new URL('seven-one-channel-order.md', import.meta.url)

/** The result of the last row in seven-one-channel-order.md for a browser, platform and codec. */
export async function recordedChannelOrderResult(
  browser: string,
  platform: string,
  codec: string,
): Promise<string | undefined> {
  const rows = (await readFile(RESULTS, 'utf8'))
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
  return rows.findLast(([b, , p, c]) => b === browser && p === platform && c === codec)?.[4]
}

/** What the page read from one splitter output per channel while the stream played. */
export interface LevelReading {
  /** The element's time at the reading. The judge does not use it: the graph can run behind. */
  mediaTime: number
  /** The page's clock at the reading, in seconds. */
  readAt: number
  /** The RMS amplitude of each splitter output's most recent samples. */
  rms: number[]
}

export interface ChannelOrderMeasurement {
  readings: LevelReading[]
  /** Why the stream did not play to its end, or null. */
  playbackError: string | null
}

/**
 * "not observed": every output read silence, as WebKit's MediaElementAudioSourceNode reads a Media
 * Source Extensions stream (WebKit bug 266922). It neither passes nor fails a browser.
 */
export type ChannelOrderResult = 'passed' | 'failed' | 'not observed' | 'did not play'

/** One tone as the graph heard it: the run of readings in which one output was the loudest. */
export interface HeardTone {
  /** The loudest output, counted from 1. */
  output: number
  /** Each splitter output's level across the middle of the run, in dBFS. */
  levels: number[]
}

export interface ChannelOrderVerdict {
  result: ChannelOrderResult
  tones: HeardTone[]
  findings: string[]
}

const REQUIRED_MARGIN_DB = 20
// The tones are written at -13.5 dBFS RMS. A reading whose loudest output is below the floor
// hears no tone: a decoder or graph may lower the level, but not make a channel all but vanish.
const TONE_FLOOR_DB = -40
const SILENCE_DB = -90
const LEVEL_FLOOR_DB = -160
// A reading within 0.1 s of either end of a tone may also hear the neighbouring tone.
const TONE_EDGE_SECONDS = 0.1
// Each tone lasts 1 s, and WebKit on Linux drops about half a second of the Opus stream. A run
// heard for less than a quarter of a tone, such as a tone leaking late into another output, is no
// tone. Only the time between neighbouring readings that hear the same output, at most 0.1 s
// apart, counts towards how long a run was heard.
const MIN_TONE_SECONDS = 0.25
const MAX_READING_GAP_SECONDS = 0.1

/**
 * Judges whether the tones reached outputs 1 to 8 in turn, each at least 20 dB above every other
 * output. A tone is a run of readings with one loudest output, heard for at least 0.25 s. The
 * order the tones arrive in identifies each one, so a graph that runs behind the element is judged
 * the same as one that keeps up.
 */
export function judgeChannelOrder(measurement: ChannelOrderMeasurement): ChannelOrderVerdict {
  if (measurement.playbackError) {
    return { result: 'did not play', tones: [], findings: [measurement.playbackError] }
  }
  const { readings } = measurement
  if (readings.length === 0) {
    const findings = ['The page took no reading while the stream played.']
    return { result: 'did not play', tones: [], findings }
  }
  if (
    readings.every(({ rms }) => rms.every((amplitude) => decibels(amplitude ** 2) <= SILENCE_DB))
  ) {
    return { result: 'not observed', tones: [], findings: [] }
  }
  const tones = heardTones(readings).map(heardTone)
  const outputs = tones.map(({ output }) => output)
  if (outputs.join() !== SEVEN_ONE_CHANNELS.map((_, index) => index + 1).join()) {
    const findings = [`The tones reached outputs ${outputs.join(', ')} in turn, not 1 to 8.`]
    return { result: 'failed', tones, findings }
  }
  const findings = tones.flatMap(narrowMargin)
  return { result: findings.length > 0 ? 'failed' : 'passed', tones, findings }
}

function decibels(power: number): number {
  return Math.max(LEVEL_FLOOR_DB, 10 * Math.log10(power))
}

function loudestOutput(levels: number[]): number {
  return levels.indexOf(Math.max(...levels))
}

// Readings below the tone floor end no run: a run picks up again on the same output after them.
function heardTones(readings: LevelReading[]): Run[] {
  const outputs = readings.map(({ rms }) =>
    decibels(Math.max(...rms) ** 2) >= TONE_FLOOR_DB ? loudestOutput(rms) : undefined,
  )
  const runs = mergeNeighbours(
    readings.flatMap((reading, index) => {
      const output = outputs[index]
      if (output === undefined) {
        return []
      }
      return [{ output, readings: [reading], heardSeconds: heardSincePrevious(index) }]
    }),
  )
  return claimShortRuns(runs)

  // A reading adds the time since the one before it only when that one heard the same output.
  function heardSincePrevious(index: number): number {
    if (index === 0 || outputs[index - 1] !== outputs[index]) {
      return 0
    }
    const gap = readings[index].readAt - readings[index - 1].readAt
    return gap <= MAX_READING_GAP_SECONDS ? gap : 0
  }
}

interface Run {
  output: number
  readings: LevelReading[]
  heardSeconds: number
}

// Readings below the tone floor end no run: a run picks up again on the same output after them.
function mergeNeighbours(runs: Run[]): Run[] {
  const merged: Run[] = []
  for (const run of runs) {
    const previous = merged.at(-1)
    if (previous?.output === run.output) {
      previous.readings.push(...run.readings)
      previous.heardSeconds += run.heardSeconds
    } else {
      merged.push({ ...run, readings: [...run.readings] })
    }
  }
  return merged
}

// A run too short to be a tone is no tone, but its readings still count against the tone it
// interrupts. One before the first tone interrupts none.
function claimShortRuns(runs: Run[]): Run[] {
  const tones: Run[] = []
  for (const run of runs) {
    const previous = tones.at(-1)
    if (run.heardSeconds < MIN_TONE_SECONDS || previous?.output === run.output) {
      previous?.readings.push(...run.readings)
    } else {
      tones.push({ ...run, readings: [...run.readings] })
    }
  }
  return tones
}

function heardTone({ output, readings }: Run): HeardTone {
  const first = readings[0].readAt
  const last = readings.at(-1)!.readAt
  const middle = readings.filter(
    ({ readAt }) => readAt >= first + TONE_EDGE_SECONDS && readAt <= last - TONE_EDGE_SECONDS,
  )
  const levels = SEVEN_ONE_CHANNELS.map((_, o) =>
    decibels(middle.reduce((sum, { rms }) => sum + rms[o] ** 2, 0) / middle.length),
  )
  return { output: output + 1, levels }
}

function narrowMargin({ output, levels }: HeardTone): string[] {
  const own = output - 1
  const others = levels.map((level, o) => ({ level, output: o })).filter((_, o) => o !== own)
  const loudestOther = others.reduce((loudest, other) =>
    other.level > loudest.level ? other : loudest,
  )
  const margin = levels[own] - loudestOther.level
  if (margin >= REQUIRED_MARGIN_DB) {
    return []
  }
  return [
    `The ${SEVEN_ONE_CHANNELS[own]} tone read ${levels[own].toFixed(1)} dBFS on output ${output} ` +
      `and ${loudestOther.level.toFixed(1)} dBFS on output ${loudestOther.output + 1}, ` +
      `a margin of ${margin.toFixed(1)} dB.`,
  ]
}
