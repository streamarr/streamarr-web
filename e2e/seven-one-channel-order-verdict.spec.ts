import { expect, test } from '@playwright/test'
import { judgeChannelOrder, SEVEN_ONE_CHANNELS, type LevelReading } from './sevenOneChannelOrder'

// The rule seven-one-channel-order.spec.ts judges a browser by, fed readings no browser produced.
// No browser is launched.

const TONE_DB = -13.5
const SILENT = 0

function amplitude(db: number): number {
  return 10 ** (db / 20)
}

/** One reading in the middle of each window, from `levels(window)`, each output's RMS amplitude. */
function readings(levels: (window: number) => number[]): LevelReading[] {
  return SEVEN_ONE_CHANNELS.map((_, window) => ({ mediaTime: window + 0.5, rms: levels(window) }))
}

/** The tone of each window on `output(window)`, `leak` on every other output. */
function toneOn(output: (window: number) => number, leak = SILENT): LevelReading[] {
  return readings((window) =>
    SEVEN_ONE_CHANNELS.map((_, o) => (o === output(window) ? amplitude(TONE_DB) : leak)),
  )
}

test('a browser passes when every tone reaches its own output 20 dB above every other', () => {
  const verdict = judgeChannelOrder({
    readings: toneOn((window) => window, amplitude(TONE_DB - 20)),
    playbackError: null,
  })

  expect(verdict.result).toBe('passed')
  expect(verdict.findings).toEqual([])
  expect(verdict.windows[3]).toEqual({
    channel: 'LFE',
    levels: [-33.5, -33.5, -33.5, -13.5, -33.5, -33.5, -33.5, -33.5].map((level) =>
      expect.closeTo(level, 6),
    ),
  })
})

test('a browser fails when another output reads a tone less than 20 dB below its own', () => {
  const verdict = judgeChannelOrder({
    readings: readings((window) =>
      SEVEN_ONE_CHANNELS.map((_, output) => {
        if (output === window) return amplitude(TONE_DB)
        // The side left tone leaks into the side right output.
        return window === 6 && output === 7 ? amplitude(TONE_DB - 19.9) : SILENT
      }),
    ),
    playbackError: null,
  })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings).toEqual([
    'The side left window read -13.5 dBFS on output 7 and -33.4 dBFS on output 8, a margin of 19.9 dB.',
  ])
})

test('a browser fails when it hands over AAC 7.1 in AAC channel order', () => {
  // AAC's own 7.1 order is centre, front left, front right, side left, side right, back left,
  // back right, LFE.
  const aacOutputOf = [1, 2, 0, 7, 5, 6, 3, 4]

  const verdict = judgeChannelOrder({
    readings: toneOn((window) => aacOutputOf[window]),
    playbackError: null,
  })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings).toHaveLength(SEVEN_ONE_CHANNELS.length)
  expect(verdict.findings[0]).toBe(
    'The front left window read -160.0 dBFS on output 1 and -13.5 dBFS on output 2, a margin of -146.5 dB.',
  )
})

test('a browser fails when it hands over 5.1, leaving the side outputs silent', () => {
  const verdict = judgeChannelOrder({
    readings: toneOn((window) => (window < 6 ? window : -1)),
    playbackError: null,
  })

  expect(verdict.result).toBe('failed')
  expect(verdict.findings.map((finding) => finding.split(' read ')[0])).toEqual([
    'The side left window',
    'The side right window',
  ])
})

test('a browser whose audio graph reads silence on every output is not observed', () => {
  const verdict = judgeChannelOrder({
    readings: readings(() => SEVEN_ONE_CHANNELS.map(() => amplitude(-95))),
    playbackError: null,
  })

  expect(verdict.result).toBe('not observed')
  expect(verdict.findings).toEqual([])
})

test('a browser that reports a playback error did not play', () => {
  const verdict = judgeChannelOrder({
    readings: toneOn((window) => window),
    playbackError: 'play() was refused',
  })

  expect(verdict).toEqual({ result: 'did not play', windows: [], findings: ['play() was refused'] })
})

test('a browser did not play when no reading falls inside a window away from its edges', () => {
  // Readings only at the edges of the back right window, where the neighbouring tones may linger.
  const atEdges = toneOn((window) => window).flatMap((reading) =>
    reading.mediaTime === 5.5
      ? [
          { ...reading, mediaTime: 5.2 },
          { ...reading, mediaTime: 5.8 },
        ]
      : [reading],
  )

  const verdict = judgeChannelOrder({ readings: atEdges, playbackError: null })

  expect(verdict).toEqual({
    result: 'did not play',
    windows: [],
    findings: ['No reading fell inside the back right window.'],
  })
})
