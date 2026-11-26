// Records what real Safari reports and plays for synthetic HDR10, HLG and Dolby Vision 8.1 HLS
// streams, on a Mac (streamarr/streamarr-server#395's measured table). CI runs Playwright's WebKit
// build instead, which is not Safari. Allow remote automation once with `safaridriver --enable`,
// then run:
//   safaridriver -p 4444 &
//   node e2e/record-safari-hdr.ts
// Needs FFmpeg with libx265, and dovi_tool. It prints the recording as JSON and as the rows of
// safari-hdr.md, and exits 1 when a fixture does not play through hls.js.
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileAnswers, servePages, type PageAnswer } from './pageServer.ts'
import { withSafari } from './safariDriver.ts'
import {
  HDR_FIXTURES,
  HDR_PICTURE,
  hdrMultivariant,
  writeHdrFixtures,
  type Playback,
  type SafariHdrRecording,
} from './safariHdr.ts'

const PAGE_PATH = '/safari-hdr'
// Each fixture plays twice, each time within 20 s.
const SCRIPT_TIMEOUT_MS = 180_000

const answers = new Map<string, PageAnswer>([
  [
    PAGE_PATH,
    {
      html: '<!doctype html><title>Safari HDR</title><script type="module" src="/e2e/safariHdrPage.ts"></script>',
    },
  ],
])
const streams = await mkdtemp(join(tmpdir(), 'safari-hdr-'))
await writeHdrFixtures(streams)
for (const fixture of HDR_FIXTURES) {
  const served = `${PAGE_PATH}/${fixture.name}`
  answers.set(`${served}/multivariant.m3u8`, {
    contentType: 'application/vnd.apple.mpegurl',
    body: hdrMultivariant(fixture),
  })
  for (const [path, answer] of await fileAnswers(served, join(streams, fixture.name))) {
    answers.set(path, answer)
  }
}
await rm(streams, { recursive: true, force: true })

const server = await servePages(answers)

function describe(playback: Playback): string {
  if (!playback.played) {
    return `did not play: ${playback.errors.join('; ')}`
  }
  const details = [
    playback.sourceBufferCodec && `SourceBuffer ${playback.sourceBufferCodec}`,
    playback.videoRange && `variant ${playback.videoRange}`,
    playback.frameColorSpace &&
      `frame ${playback.frameColorSpace.transfer} ${playback.frameColorSpace.primaries}`,
  ].filter(Boolean)
  return `played (${details.join(', ')})`
}

const run = promisify(execFile)
const macOS = (await run('sw_vers', ['-productVersion'])).stdout.trim()
const build = (await run('sw_vers', ['-buildVersion'])).stdout.trim()

try {
  await withSafari(SCRIPT_TIMEOUT_MS, async (safari) => {
    await safari.open(`${server.origin}${PAGE_PATH}`)
    const recording = await safari.executeAsync<SafariHdrRecording>(
      `const done = arguments[arguments.length - 1];
      const until = (check) => check() ? Promise.resolve() :
        new Promise((resolve) => setTimeout(resolve, 50)).then(() => until(check));
      until(() => window.recordSafariHdr)
        .then(() => window.recordSafariHdr(arguments[0], arguments[1]))
        .then(done)`,
      [
        HDR_FIXTURES.map((fixture) => ({
          fixture,
          url: `${PAGE_PATH}/${fixture.name}/multivariant.m3u8`,
        })),
        HDR_PICTURE,
      ],
    )
    console.log(JSON.stringify(recording, null, 2))
    console.log(`Safari ${safari.browserVersion} on macOS ${macOS} (${build})`)
    console.log(`Display shows high dynamic range: ${recording.displaysHighDynamicRange}`)
    console.log(`Declared HEVC entries: ${JSON.stringify(recording.declaredHevc)}`)
    console.log('| Fixture | hls.js | Native player |')
    console.log('| --- | --- | --- |')
    for (const { fixture, hlsJs, native } of recording.fixtures) {
      console.log(`| ${fixture} | ${describe(hlsJs)} | ${describe(native)} |`)
      if (!hlsJs.played) {
        process.exitCode = 1
      }
    }
  })
} finally {
  await server.close()
}
