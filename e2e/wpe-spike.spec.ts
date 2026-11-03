import { test } from '@playwright/test'

const AUDIO: MediaDecodingConfiguration = {
  type: 'media-source',
  audio: { contentType: 'audio/mp4; codecs="mp4a.40.2"', channels: '2', bitrate: 384000, samplerate: 48000 },
}
const VIDEO: MediaDecodingConfiguration = {
  type: 'media-source',
  video: { contentType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, framerate: 30, bitrate: 10000000 },
}

type Step = 'create-close' | 'create-read-close' | 'create-read-noclose' | 'audio' | 'video' | 'wait'

const CASES: Record<string, Step[]> = {
  control_audio_video: ['audio', 'video'],
  create_close_then_audio: ['create-close', 'audio'],
  create_close_then_video: ['create-close', 'video'],
  read_close_then_audio: ['create-read-close', 'audio'],
  read_close_then_video: ['create-read-close', 'video'],
  read_noclose_then_audio: ['create-read-noclose', 'audio'],
  read_close_wait_then_audio: ['create-read-close', 'wait', 'audio'],
  read_close_twice: ['create-read-close', 'create-read-close'],
  audio_then_create_close: ['audio', 'create-close'],
  audio_then_read_close: ['audio', 'create-read-close'],
}

for (const [name, steps] of Object.entries(CASES)) {
  test(`SPIKE ${name}`, async ({ page }) => {
    page.on('crash', () => console.log(`SPIKE-RESULT ${name} CRASH`))
    await page.route('**/spike', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>s</title>' }),
    )
    await page.goto('/spike')
    try {
      const out = await page.evaluate(
        async ({ steps, audio, video }) => {
          const log: string[] = []
          for (const step of steps) {
            if (step === 'audio') log.push(`audio=${(await navigator.mediaCapabilities.decodingInfo(audio)).supported}`)
            if (step === 'video') log.push(`video=${(await navigator.mediaCapabilities.decodingInfo(video)).supported}`)
            if (step === 'wait') await new Promise((r) => setTimeout(r, 2000))
            if (step === 'create-close') { const c = new AudioContext(); await c.close(); log.push('closed') }
            if (step === 'create-read-close') { const c = new AudioContext(); log.push(`max=${c.destination.maxChannelCount}`); await c.close() }
            if (step === 'create-read-noclose') { const c = new AudioContext(); log.push(`max=${c.destination.maxChannelCount}`) }
          }
          await new Promise((r) => setTimeout(r, 1000))
          return log.join(' ')
        },
        { steps, audio: AUDIO, video: VIDEO },
      )
      console.log(`SPIKE-RESULT ${name} OK ${out}`)
    } catch (error) {
      console.log(`SPIKE-RESULT ${name} FAIL ${String(error).slice(0, 80)}`)
    }
  })
}
