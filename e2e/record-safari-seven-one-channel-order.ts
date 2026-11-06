// Records how real Safari's decoders hand a 7.1 stream to the audio graph, on a Mac, with the page
// and judge of seven-one-channel-order.spec.ts. CI runs Playwright's WebKit build instead, which is
// not Safari. Allow remote automation once with `safaridriver --enable`, then run:
//   safaridriver -p 4444 &
//   node e2e/record-safari-seven-one-channel-order.ts
// Needs FFmpeg with libopus. It prints one row of seven-one-channel-order.md for each codec, and
// exits 1 when a result differs from the last row recorded for Safari on macOS.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createServer, type Plugin } from 'vite'
import { withSafari } from './safariDriver.ts'
import {
  CODEC_FIXTURES,
  judgeChannelOrder,
  recordedChannelOrderResult,
  SEVEN_ONE_PAGE,
  SEVEN_ONE_PAGE_PATH,
  SEVEN_ONE_STREAM_FILE,
  SEVEN_ONE_STREAM_PATH,
  sevenOneMultivariant,
  writeSevenOneStream,
  type ChannelOrderCodec,
  type ChannelOrderMeasurement,
} from './sevenOneChannelOrder.ts'

const CODECS = Object.keys(CODEC_FIXTURES) as ChannelOrderCodec[]
// The page waits 30 s for the 11 s stream to end.
const SCRIPT_TIMEOUT_MS = 60_000

const streams = await mkdtemp(join(tmpdir(), 'seven-one-safari-'))
for (const codec of CODECS) {
  await mkdir(join(streams, codec))
  await writeSevenOneStream(codec, join(streams, codec))
}

// The codec that the page plays now. The page and its stream share the dev server's origin, because
// a cross-origin element without CORS feeds Web Audio silence.
let playing: ChannelOrderCodec = 'AAC'
const sevenOneStream: Plugin = {
  name: 'seven-one-stream',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const { pathname } = new URL(request.url ?? '/', 'http://localhost')
      const file = SEVEN_ONE_STREAM_FILE.exec(pathname)?.[1]
      if (pathname === SEVEN_ONE_PAGE_PATH) {
        response.setHeader('content-type', 'text/html')
        server.transformIndexHtml(pathname, SEVEN_ONE_PAGE).then((html) => response.end(html), next)
        return
      }
      if (pathname === `${SEVEN_ONE_STREAM_PATH}/multivariant.m3u8`) {
        response.setHeader('content-type', 'application/vnd.apple.mpegurl')
        response.end(sevenOneMultivariant(CODEC_FIXTURES[playing].codecs))
        return
      }
      if (file) {
        readFile(join(streams, playing, file)).then((bytes) => response.end(bytes), next)
        return
      }
      next()
    })
  },
}

const server = await createServer({
  configFile: false,
  root: join(import.meta.dirname, '..'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [sevenOneStream],
})
await server.listen()
const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? ''
const { stdout } = await promisify(execFile)('sw_vers', ['-productVersion'])
const macOS = stdout.trim()

try {
  await withSafari(SCRIPT_TIMEOUT_MS, async (safari) => {
    for (const codec of CODECS) {
      playing = codec
      await safari.open(
        `${origin}${SEVEN_ONE_PAGE_PATH}?stream=${SEVEN_ONE_STREAM_PATH}/multivariant.m3u8`,
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
  await rm(streams, { recursive: true, force: true })
}
