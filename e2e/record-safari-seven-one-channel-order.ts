// Records how real Safari's decoders hand a 7.1 stream to the audio graph, on a Mac, with the page
// and judge of seven-one-channel-order.spec.ts. CI runs Playwright's WebKit build instead, which is
// not Safari. Allow remote automation once with `safaridriver --enable`, then run:
//   safaridriver -p 4444 &
//   node e2e/record-safari-seven-one-channel-order.ts
// Needs FFmpeg with libopus. It prints one row of seven-one-channel-order.md for each codec, and
// exits 1 when a result differs from the last row recorded for Safari on macOS.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { servePages, type PageAnswer } from './pageServer.ts'
import { withSafari } from './safariDriver.ts'
import {
  CODEC_FIXTURES,
  judgeChannelOrder,
  recordedChannelOrderResult,
  SEVEN_ONE_PAGE,
  SEVEN_ONE_PAGE_PATH,
  SEVEN_ONE_STREAM_PATH,
  sevenOneMultivariant,
  writeSevenOneStream,
  type ChannelOrderCodec,
  type ChannelOrderMeasurement,
} from './sevenOneChannelOrder.ts'

const CODECS = Object.keys(CODEC_FIXTURES) as ChannelOrderCodec[]
// The page waits 30 s for the 11 s stream to end.
const SCRIPT_TIMEOUT_MS = 60_000

// The page and its streams share one origin, because a cross-origin element without CORS feeds
// Web Audio silence. Each codec's stream sits in its own directory under the stream path.
const answers = new Map<string, PageAnswer>([[SEVEN_ONE_PAGE_PATH, { html: SEVEN_ONE_PAGE }]])
const streams = await mkdtemp(join(tmpdir(), 'seven-one-safari-'))
for (const codec of CODECS) {
  const directory = join(streams, codec)
  await mkdir(directory)
  await writeSevenOneStream(codec, directory)
  const served = `${SEVEN_ONE_STREAM_PATH}/${codec}`
  answers.set(`${served}/multivariant.m3u8`, {
    contentType: 'application/vnd.apple.mpegurl',
    body: sevenOneMultivariant(CODEC_FIXTURES[codec].codecs),
  })
  for (const file of await readdir(directory)) {
    answers.set(`${served}/${file}`, {
      contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
      body: await readFile(join(directory, file)),
    })
  }
}
await rm(streams, { recursive: true, force: true })

const server = await servePages(answers)
const { stdout } = await promisify(execFile)('sw_vers', ['-productVersion'])
const macOS = stdout.trim()

try {
  await withSafari(SCRIPT_TIMEOUT_MS, async (safari) => {
    for (const codec of CODECS) {
      await safari.open(
        `${server.origin}${SEVEN_ONE_PAGE_PATH}?stream=${SEVEN_ONE_STREAM_PATH}/${codec}/multivariant.m3u8`,
      )
      await safari.click('button')
      const measurement = await safari.executeAsync<ChannelOrderMeasurement>(
        'window.channelOrder.then(arguments[arguments.length - 1])',
      )
      const verdict = judgeChannelOrder(measurement)
      const recorded = await recordedChannelOrderResult('safari', 'macOS', codec)
      const note = verdict.result === 'passed' ? '' : verdict.findings.join(' ')
      console.log(
        `| safari | ${safari.browserVersion} | macOS | ${codec} | ${verdict.result} | ${note} |`,
      )
      if (verdict.result !== recorded) {
        console.log(`Recorded for Safari on macOS ${macOS}: ${recorded ?? 'nothing'}`)
        process.exitCode = 1
      }
    }
  })
  console.log(`macOS ${macOS}`)
} finally {
  await server.close()
}
