import Hls from 'hls.js'
import { hlsPlaybackConfig } from '../src/streaming/hlsPlaybackConfig'
import type { ChannelOrderMeasurement, LevelReading } from './sevenOneChannelOrder'

// The page of seven-one-channel-order.spec.ts, which Vite's dev server serves. It plays the stream
// named by the `stream` query parameter through hls.js on Media Source Extensions with the
// player's hls.js settings, and reads each channel through a ChannelSplitterNode. The Start
// button's click is the user gesture that lets the AudioContext run and the element play.

declare global {
  interface Window {
    channelOrder?: Promise<ChannelOrderMeasurement>
  }
}

const OUTPUTS = 8
const READ_INTERVAL_MS = 20
const ANALYSER_SAMPLES = 2048

const video = document.querySelector('video')!
const start = document.querySelector('button')!
// Every hls.js and media error since the page loaded, to explain a stream that did not play.
const errors: string[] = []
const hls: Hls = new Hls(hlsPlaybackConfig(() => hls))
hls.on(Hls.Events.ERROR, (_, data) => {
  errors.push(
    `hls.js ${data.fatal ? 'fatal' : 'non-fatal'} ${data.details}: ${data.error?.message}`,
  )
})
video.addEventListener('error', () => {
  errors.push(`media error ${video.error?.code}: ${video.error?.message}`)
})
hls.attachMedia(video)
hls.loadSource(new URLSearchParams(location.search).get('stream') ?? '')

start.addEventListener(
  'click',
  () => {
    window.channelOrder = measure()
  },
  { once: true },
)

async function measure(): Promise<ChannelOrderMeasurement> {
  const ended = playedToEnd()
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
    if (video.paused) {
      return
    }
    const rms = analysers.map((analyser) => {
      analyser.getFloatTimeDomainData(samples)
      return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
    })
    readings.push({ mediaTime: video.currentTime, rms })
  }, READ_INTERVAL_MS)
  const resumed = context.resume()
  const refused = await video.play().then(
    () => false,
    () => true,
  )
  await resumed
  let playbackError: string | null = null
  if (refused) {
    playbackError = ['play() was refused', ...errors].join('; ')
  } else if (!(await ended)) {
    playbackError = ['Playback stopped before the end', ...errors].join('; ')
  }
  clearInterval(reading)
  hls.destroy()
  await context.close()
  return { readings, playbackError }
}

/** Whether the element plays to its end before a media error or a fatal hls.js error. */
function playedToEnd(): Promise<boolean> {
  return new Promise((resolve) => {
    video.addEventListener('ended', () => resolve(true), { once: true })
    video.addEventListener('error', () => resolve(false), { once: true })
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        resolve(false)
      }
    })
  })
}
