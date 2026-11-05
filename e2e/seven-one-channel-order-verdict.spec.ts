import { expect, test } from '@playwright/test'
import { judgeChannelOrder, SEVEN_ONE_CHANNELS, type LevelReading } from './sevenOneChannelOrder'

// The rule seven-one-channel-order.spec.ts judges a browser by, fed readings no browser produced.
// No browser is launched.

const TONE_DB = -13.5
const SILENT = 0
const READINGS_PER_TONE = 20
const READ_SECONDS = 0.05

function amplitude(db: number): number {
  return 10 ** (db / 20)
}

/** Each output's RMS amplitude while `output` alone carries a tone, `leak` on every other. */
function toneOnOutput(output: number, leak = SILENT): number[] {
  return SEVEN_ONE_CHANNELS.map((_, o) => (o === output ? amplitude(TONE_DB) : leak))
}

/** A second of silence, then each tone in turn for READINGS_PER_TONE readings, then silence. */
function readingsOf(tones: number[][]): LevelReading[] {
  const silence = Array.from({ length: READINGS_PER_TONE }, () => SEVEN_ONE_CHANNELS.map(() => 0))
  const tonesInTurn = tones.flatMap((rms) => Array.from({ length: READINGS_PER_TONE }, () => rms))
  return [...silence, ...tonesInTurn, ...silence].map((rms, index) => ({
    mediaTime: index * READ_SECONDS,
    readAt: index * READ_SECONDS,
    rms,
  }))
}

function inOrder(leak = SILENT): number[][] {
  return SEVEN_ONE_CHANNELS.map((_, output) => toneOnOutput(output, leak))
}

test('a browser passes when every tone reaches its own output, in order, 20 dB above every other', () => {
  const verdict = judgeChannelOrder({
    readings: readingsOf(inOrder(amplitude(TONE_DB - 20))),
    playbackError: null,
  })

  expect(verdict.result).toBe('passed')
  expect(verdict.findings).toEqual([])
  expect(verdict.tones.map(({ output }) => output)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  expect(verdict.tones[3].levels).toEqual(
    [-33.5, -33.5, -33.5, -13.5, -33.5, -33.5, -33.5, -33.5].map((level) =>
      expect.closeTo(level, 6),
    ),
  )
})

test('a browser passes whatever the delay between the element and its audio graph', () => {
  // WebKit on Linux runs its graph up to a second behind the element's time.
  const late = readingsOf(inOrder()).map((reading) => ({
    ...reading,
    mediaTime: reading.mediaTime + 1.3,
  }))

  expect(judgeChannelOrder({ readings: late, playbackError: null }).result).toBe('passed')
})

test('a browser passes when readings that span two tones read both', () => {
  const tones = inOrder()
  const readings = readingsOf(tones).map((reading, index) => {
    // The reading at the end of each tone's run also hears the next tone 3 dB down.
    const tone = Math.floor(index / READINGS_PER_TONE) - 1
    const last = index % READINGS_PER_TONE === READINGS_PER_TONE - 1
    if (!last || tone < 0 || tone >= tones.length - 1) return reading
    return {
      ...reading,
      rms: reading.rms.map((rms, o) => (o === tone + 1 ? amplitude(-16.5) : rms)),
    }
  })

  const verdict = judgeChannelOrder({ readings, playbackError: null })

  expect(verdict.result).toBe('passed')
})

test('a browser passes when the graph drops audio in the middle of a tone', () => {
  // WebKit on Linux hears the centre tone, then silence, then the rest of the centre tone.
  const centreStart = READINGS_PER_TONE * 3
  const readings = readingsOf(inOrder()).map((reading, index) =>
    index >= centreStart + 8 && index < centreStart + 12
      ? { ...reading, rms: reading.rms.map(() => SILENT) }
      : reading,
  )

  const verdict = judgeChannelOrder({ readings, playbackError: null })

  expect(verdict.result).toBe('passed')
  expect(verdict.tones.map(({ output }) => output)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
})

test('a browser fails when another output reads a tone less than 20 dB below its own', () => {
  const tones = inOrder()
  // The side left tone leaks into the side right output.
  tones[6] = tones[6].map((rms, output) => (output === 7 ? amplitude(TONE_DB - 19.9) : rms))

  const verdict = judgeChannelOrder({ readings: readingsOf(tones), playbackError: null })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings).toEqual([
    'The side left tone read -13.5 dBFS on output 7 and -33.4 dBFS on output 8, a margin of 19.9 dB.',
  ])
})

test('a browser fails when another output briefly drowns out a tone in its middle', () => {
  // For 0.2 s in the middle of the LFE tone, output 1 reads 0.8 dB louder than output 4.
  const readings = readingsOf(inOrder()).map((reading, index) => {
    const lfe = Math.floor(index / READINGS_PER_TONE) === 4
    if (!lfe || index % READINGS_PER_TONE < 8 || index % READINGS_PER_TONE > 11) return reading
    return {
      ...reading,
      rms: reading.rms.map((rms, o) => (o === 0 ? amplitude(TONE_DB) * 1.1 : rms)),
    }
  })

  const verdict = judgeChannelOrder({ readings, playbackError: null })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings).toEqual([
    expect.stringMatching(
      /^The LFE tone read -13\.5 dBFS on output 4 and -\d+\.\d dBFS on output 1, a margin of \d+\.\d dB\.$/,
    ),
  ])
})

test('a browser fails when it hands over AAC 7.1 in AAC channel order', () => {
  // AAC's own 7.1 order is centre, front left, front right, side left, side right, back left,
  // back right, LFE.
  const aacOutputOf = [1, 2, 0, 7, 5, 6, 3, 4]

  const verdict = judgeChannelOrder({
    readings: readingsOf(aacOutputOf.map((output) => toneOnOutput(output))),
    playbackError: null,
  })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings).toEqual([
    'The tones reached outputs 2, 3, 1, 8, 6, 7, 4, 5 in turn, not 1 to 8.',
  ])
})

test('a browser fails when it hands over 5.1, leaving the side outputs silent', () => {
  const tones = inOrder().map((rms, tone) => (tone < 6 ? rms : rms.map(() => SILENT)))

  const verdict = judgeChannelOrder({ readings: readingsOf(tones), playbackError: null })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings).toEqual([
    'The tones reached outputs 1, 2, 3, 4, 5, 6 in turn, not 1 to 8.',
  ])
})

test('a browser fails when a tone leaking briefly into a silent output stands in for its own', () => {
  // The front right channel is lost, and the front left tone reaches output 2 for 0.1 s after it
  // ends, 22.5 dB down: loud enough to pass for a tone, too short to be one.
  const readings = readingsOf(inOrder()).map((reading, index) => {
    const frontRight = Math.floor(index / READINGS_PER_TONE) === 2
    if (!frontRight) return reading
    const leaking = index % READINGS_PER_TONE < 2
    return { ...reading, rms: toneOnOutput(leaking ? 1 : -1).map((rms) => rms * amplitude(-22.5)) }
  })

  const verdict = judgeChannelOrder({ readings, playbackError: null })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings).toEqual([
    'The tones reached outputs 1, 3, 4, 5, 6, 7, 8 in turn, not 1 to 8.',
  ])
})

test('a browser fails when a tone leaking in bursts into a silent output stands in for its own', () => {
  // The front right channel is lost, and output 2 hears two 0.1 s bursts of the front left tone,
  // 22.5 dB down and 0.8 s apart.
  const readings = readingsOf(inOrder()).map((reading, index) => {
    const frontRight = Math.floor(index / READINGS_PER_TONE) === 2
    if (!frontRight) return reading
    const leaking = [0, 1, 18, 19].includes(index % READINGS_PER_TONE)
    return { ...reading, rms: toneOnOutput(leaking ? 1 : -1).map((rms) => rms * amplitude(-22.5)) }
  })

  const verdict = judgeChannelOrder({ readings, playbackError: null })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings).toEqual([
    'The tones reached outputs 1, 3, 4, 5, 6, 7, 8 in turn, not 1 to 8.',
  ])
})

test('a browser fails when leakage in pairs of readings, each pair after a silent one, stands in for a tone', () => {
  // The front right channel is lost, and output 2 hears the front left tone 22.5 dB down in pairs
  // of readings with a silent reading between pairs: 0.2 s heard across 0.55 s.
  const readings = readingsOf(inOrder()).map((reading, index) => {
    const frontRight = Math.floor(index / READINGS_PER_TONE) === 2
    if (!frontRight) return reading
    const leaking = [0, 1, 3, 4, 6, 7, 9, 10].includes(index % READINGS_PER_TONE)
    return { ...reading, rms: toneOnOutput(leaking ? 1 : -1).map((rms) => rms * amplitude(-22.5)) }
  })

  const verdict = judgeChannelOrder({ readings, playbackError: null })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings).toEqual([
    'The tones reached outputs 1, 3, 4, 5, 6, 7, 8 in turn, not 1 to 8.',
  ])
})

test('a browser passes when the graph drops most of a tone but hears 0.3 s of it', () => {
  // WebKit on Linux drops about half a second of the 7.1 Opus stream.
  const readings = readingsOf(inOrder()).filter((_, index) => {
    const sideLeft = Math.floor(index / READINGS_PER_TONE) === 7
    return !sideLeft || index % READINGS_PER_TONE >= 13
  })

  const verdict = judgeChannelOrder({ readings, playbackError: null })

  expect(verdict.result).toBe('passed')
})

test('a browser fails when a tone reads far below the level of the stream', () => {
  const tones = inOrder()
  // The back left and back right tones arrive 106.5 dB down, though alone on their outputs.
  tones[4] = toneOnOutput(-1).map((rms, output) => (output === 4 ? amplitude(-120) : rms))
  tones[5] = toneOnOutput(-1).map((rms, output) => (output === 5 ? amplitude(-120) : rms))

  const verdict = judgeChannelOrder({ readings: readingsOf(tones), playbackError: null })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings).toEqual([
    'The tones reached outputs 1, 2, 3, 4, 7, 8 in turn, not 1 to 8.',
  ])
})

test('a browser whose audio graph reads silence on every output is not observed', () => {
  const quiet = SEVEN_ONE_CHANNELS.map(() => SEVEN_ONE_CHANNELS.map(() => amplitude(-95)))

  const verdict = judgeChannelOrder({ readings: readingsOf(quiet), playbackError: null })

  expect(verdict.result).toBe('not observed')
  expect(verdict.findings).toEqual([])
})

test('a browser that reports a playback error did not play', () => {
  const verdict = judgeChannelOrder({
    readings: readingsOf(inOrder()),
    playbackError: 'play() was refused',
  })

  expect(verdict).toEqual({ result: 'did not play', tones: [], findings: ['play() was refused'] })
})

test('a browser did not play when the page took no reading', () => {
  const verdict = judgeChannelOrder({ readings: [], playbackError: null })

  expect(verdict).toEqual({
    result: 'did not play',
    tones: [],
    findings: ['The page took no reading while the stream played.'],
  })
})
