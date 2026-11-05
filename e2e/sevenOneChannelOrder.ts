import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

// The synthetic 7.1 stream of seven-one-channel-order.spec.ts and the rule that judges what a
// browser's audio graph read from it. In each 1 s window only one channel carries a tone, in
// FFmpeg's 7.1 order.

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

const TONE_HZ = 1000
// Encoders low-pass the LFE channel.
const LFE_TONE_HZ = 50
const TONE_AMPLITUDE = 0.3

function toneExpressions(): string {
  return SEVEN_ONE_CHANNELS.map((channel, window) => {
    const hertz = channel === 'LFE' ? LFE_TONE_HZ : TONE_HZ
    return `if(between(t\\,${window}\\,${window + 1})\\,${TONE_AMPLITUDE}*sin(2*PI*${hertz}*t)\\,0)`
  }).join('|')
}

/**
 * Writes the synthetic 7.1 stream in `codec` to `directory` as an fMP4 media playlist,
 * stream.m3u8, with its init.mp4 and one media segment, segment0.m4s. Needs FFmpeg with libopus.
 */
export async function writeSevenOneStream(
  codec: ChannelOrderCodec,
  directory: string,
): Promise<void> {
  const source = `aevalsrc=exprs=${toneExpressions()}:channel_layout=7.1:sample_rate=48000:duration=${SEVEN_ONE_CHANNELS.length}`
  await promisify(execFile)('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source],
    ...CODEC_FIXTURES[codec].encoder,
    ...['-f', 'hls', '-hls_time', '10', '-hls_playlist_type', 'vod'],
    ...['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'],
    ...['-hls_segment_filename', join(directory, 'segment%d.m4s'), join(directory, 'stream.m3u8')],
  ])
}

/** What the page read from one splitter output per channel while the stream played. */
export interface LevelReading {
  mediaTime: number
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

export interface WindowLevels {
  channel: string
  /** Each splitter output's level across the window, in dBFS. */
  levels: number[]
}

export interface ChannelOrderVerdict {
  result: ChannelOrderResult
  windows: WindowLevels[]
  findings: string[]
}

const REQUIRED_MARGIN_DB = 20
const SILENCE_DB = -90
const LEVEL_FLOOR_DB = -160
// The analysers read the graph a few tens of milliseconds behind the element's current time, so
// readings near a window's edges may hold the neighbouring window's tone.
const WINDOW_EDGE_SECONDS = 0.25

/** Judges whether each window's tone reached its own output at least 20 dB above every other. */
export function judgeChannelOrder(measurement: ChannelOrderMeasurement): ChannelOrderVerdict {
  if (measurement.playbackError) {
    return { result: 'did not play', windows: [], findings: [measurement.playbackError] }
  }
  const windows = SEVEN_ONE_CHANNELS.map((channel, window) => ({
    channel,
    readings: measurement.readings.filter(
      ({ mediaTime }) =>
        mediaTime >= window + WINDOW_EDGE_SECONDS && mediaTime <= window + 1 - WINDOW_EDGE_SECONDS,
    ),
  }))
  const unread = windows.filter(({ readings }) => readings.length === 0)
  if (unread.length > 0) {
    const findings = unread.map(({ channel }) => `No reading fell inside the ${channel} window.`)
    return { result: 'did not play', windows: [], findings }
  }
  const levels = windows.map(({ channel, readings }) => ({
    channel,
    levels: windowLevels(readings),
  }))
  if (levels.every((window) => window.levels.every((level) => level <= SILENCE_DB))) {
    return { result: 'not observed', windows: levels, findings: [] }
  }
  const findings = levels.flatMap(misplacedTone)
  return { result: findings.length > 0 ? 'failed' : 'passed', windows: levels, findings }
}

function windowLevels(readings: LevelReading[]): number[] {
  return SEVEN_ONE_CHANNELS.map((_, output) => {
    const power = readings.reduce((sum, { rms }) => sum + rms[output] ** 2, 0) / readings.length
    return Math.max(LEVEL_FLOOR_DB, 10 * Math.log10(power))
  })
}

function misplacedTone({ channel, levels }: WindowLevels, expected: number): string[] {
  const others = levels.map((level, output) => ({ level, output })).filter((_, i) => i !== expected)
  const loudestOther = others.reduce((loudest, other) =>
    other.level > loudest.level ? other : loudest,
  )
  const margin = levels[expected] - loudestOther.level
  if (margin >= REQUIRED_MARGIN_DB) {
    return []
  }
  return [
    `The ${channel} window read ${levels[expected].toFixed(1)} dBFS on output ${expected + 1} and ` +
      `${loudestOther.level.toFixed(1)} dBFS on output ${loudestOther.output + 1}, ` +
      `a margin of ${margin.toFixed(1)} dB.`,
  ]
}
