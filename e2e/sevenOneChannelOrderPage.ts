import Hls from 'hls.js'
import { hlsPlaybackConfig } from '../src/streaming/hlsPlaybackConfig'
import type { ChannelOrderMeasurement, LevelReading } from './sevenOneChannelOrder'

// The page of seven-one-channel-order.spec.ts, which Vite's dev server serves. It plays the stream
// named by the `stream` query parameter through hls.js on Media Source Extensions with the
// player's hls.js settings, and reads each channel through a ChannelSplitterNode. The Start
// button's click is the user gesture that lets the AudioContext run and the element play. The
// `deadline` query parameter shortens the 30 s the page waits for the end of the stream.

declare global {
  interface Window {
    channelOrder?: Promise<ChannelOrderMeasurement>
  }
}

const OUTPUTS = 8
const READ_INTERVAL_MS = 20
const ANALYSER_SAMPLES = 2048
const parameters = new URLSearchParams(location.search)
// The stream lasts 11 s.
const PLAYBACK_DEADLINE_SECONDS = Number(parameters.get('deadline') ?? 30)

const PLAYBACK_ERRORS = {
  refused: 'play() was refused',
  stopped: 'Playback stopped before the end',
  'timed out': `Playback did not reach the end within ${PLAYBACK_DEADLINE_SECONDS} s`,
}

const video = document.querySelector('video')!
const start = document.querySelector('button')!
// Every hls.js and media error since the page loaded, to explain a stream that did not play.
const errors: string[] = []
// The test streams are SDR, so the page asks for SDR as a client that declares no HDR range does.
const hls: Hls = new Hls(
  hlsPlaybackConfig(() => hls, { preferHDR: false, allowedVideoRanges: ['SDR'] }),
)
hls.on(Hls.Events.ERROR, (_, data) => {
  errors.push(
    `hls.js ${data.fatal ? 'fatal' : 'non-fatal'} ${data.details}: ${data.error?.message}`,
  )
})
video.addEventListener('error', () => {
  errors.push(`media error ${video.error?.code}: ${video.error?.message}`)
})
// hls.js can stop on a fatal error before the click, and play() then never settles.
const finished = new Promise<'ended' | 'stopped'>((resolve) => {
  video.addEventListener('ended', () => resolve('ended'), { once: true })
  video.addEventListener('error', () => resolve('stopped'), { once: true })
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (data.fatal) {
      resolve('stopped')
    }
  })
})
hls.attachMedia(video)
hls.loadSource(parameters.get('stream') ?? '')

start.addEventListener(
  'click',
  () => {
    window.channelOrder = measure()
  },
  { once: true },
)

async function measure(): Promise<ChannelOrderMeasurement> {
  const context = new AudioContext()
  const splitter = context.createChannelSplitter(OUTPUTS)
  context.createMediaElementSource(video).connect(splitter)
  // Only nodes that lead to the destination are sure to be processed; the gain keeps them silent.
  const muted = context.createGain()
  muted.gain.value = 0
  muted.connect(context.destination)
  const analysers = Array.from({ length: OUTPUTS }, (_, output) => {
    const analyser = context.createAnalyser()
    analyser.fftSize = ANALYSER_SAMPLES
    splitter.connect(analyser, output)
    analyser.connect(muted)
    return analyser
  })
  const readings: LevelReading[] = []
  const samples = new Float32Array(ANALYSER_SAMPLES)
  const reading = setInterval(() => {
    const rms = analysers.map((analyser) => {
      analyser.getFloatTimeDomainData(samples)
      return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
    })
    readings.push({ mediaTime: video.currentTime, readAt: performance.now() / 1000, rms })
  }, READ_INTERVAL_MS)
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    // Firefox on Linux without an audio server never resumes; its outputs then read silence.
    void context.resume()
    const outcome = await Promise.race([
      finished,
      video.play().then(
        () => finished,
        () => 'refused' as const,
      ),
      new Promise<'timed out'>((resolve) => {
        deadline = setTimeout(() => resolve('timed out'), PLAYBACK_DEADLINE_SECONDS * 1000)
      }),
    ])
    if (outcome === 'ended') {
      return { readings, playbackError: null }
    }
    return { readings, playbackError: [PLAYBACK_ERRORS[outcome], ...errors].join('; ') }
  } finally {
    clearTimeout(deadline)
    clearInterval(reading)
    hls.destroy()
    await context.close()
  }
}
