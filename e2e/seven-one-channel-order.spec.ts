import { expect, test, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CODEC_FIXTURES,
  judgeChannelOrder,
  writeSevenOneStream,
  type ChannelOrderCodec,
  type ChannelOrderMeasurement,
  type ChannelOrderResult,
} from './sevenOneChannelOrder'

// A browser declares 8 channels for an audio codec only when its decoder hands a 7.1 stream to the
// audio graph in the right order (streamarr/streamarr-web#29). This spec plays a synthetic 7.1
// stream in each codec that can carry 7.1 to a browser, and fails when the result differs from the
// one recorded for this browser and platform in seven-one-channel-order.md.

const RESULTS = fileURLToPath(new URL('seven-one-channel-order.md', import.meta.url))
const CODECS = Object.keys(CODEC_FIXTURES) as ChannelOrderCodec[]
const PLATFORMS: Partial<Record<NodeJS.Platform, string>> = { darwin: 'macOS', linux: 'Linux' }

// A cross-origin element without CORS feeds Web Audio silence, so the page and the stream share
// the app's origin.
const PAGE_PATH = '/seven-one-channel-order'
const STREAM_PATH = '/seven-one-channel-order/stream'
const STREAM_FILE = /^\/seven-one-channel-order\/stream\/(stream\.m3u8|init\.mp4|segment\d+\.m4s)$/

let streams: string

test.beforeAll(async () => {
  streams = await mkdtemp(join(tmpdir(), 'seven-one-'))
  for (const codec of CODECS) {
    await mkdir(join(streams, codec))
    await writeSevenOneStream(codec, join(streams, codec))
  }
})

test.afterAll(async () => {
  await rm(streams, { recursive: true, force: true })
})

// `codecs` is the multivariant playlist's CODECS attribute.
async function serveStream(
  page: Page,
  codec: ChannelOrderCodec,
  codecs = CODEC_FIXTURES[codec].codecs,
): Promise<void> {
  await page.route(
    (url) => url.pathname === PAGE_PATH,
    (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: [
          '<!doctype html><title>7.1 channel order</title>',
          '<video></video><button>Start</button>',
          '<script type="module" src="/e2e/sevenOneChannelOrderPage.ts"></script>',
        ].join(''),
      }),
  )
  await page.route(
    (url) => url.pathname === `${STREAM_PATH}/multivariant.m3u8`,
    (route) =>
      route.fulfill({
        contentType: 'application/vnd.apple.mpegurl',
        body: [
          '#EXTM3U',
          `#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="${codecs}"`,
          'stream.m3u8',
          '',
        ].join('\n'),
      }),
  )
  await page.route(
    (url) => STREAM_FILE.test(url.pathname),
    (route) => {
      const [, file] = STREAM_FILE.exec(new URL(route.request().url()).pathname)!
      return route.fulfill({ path: join(streams, codec, file) })
    },
  )
}

async function measure(page: Page): Promise<ChannelOrderMeasurement> {
  await page.goto(`${PAGE_PATH}?stream=${STREAM_PATH}/multivariant.m3u8`)
  await page.getByRole('button', { name: 'Start' }).click()
  return page.evaluate(() => window.channelOrder!)
}

// The last row for a browser, platform and codec holds the result this spec expects.
async function recordedResult(
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

for (const codec of CODECS) {
  test(`${codec} 7.1 reaches the audio graph as the recorded result says`, async ({
    page,
    browser,
  }, testInfo) => {
    await serveStream(page, codec)

    const measurement = await measure(page)

    const verdict = judgeChannelOrder(measurement)
    const row = {
      browser: testInfo.project.name,
      version: browser.version(),
      platform: PLATFORMS[process.platform] ?? process.platform,
      codec,
      result: verdict.result satisfies ChannelOrderResult,
    }
    const recording = testInfo.outputPath(`seven-one-channel-order-${codec}.json`)
    await writeFile(recording, JSON.stringify({ ...row, ...verdict, measurement }, null, 2))
    await testInfo.attach(`seven-one-channel-order-${codec}.json`, {
      path: recording,
      contentType: 'application/json',
    })
    expect(
      verdict.result,
      `Record this row in e2e/seven-one-channel-order.md: ${JSON.stringify(row)}; ` +
        verdict.findings.join(' '),
    ).toBe(await recordedResult(row.browser, row.platform, codec))
  })
}

test('a stream that hls.js cannot play is judged as not played', async ({ page }) => {
  // hls.js stops with a fatal error on a playlist no browser decodes, while play() still waits.
  await serveStream(page, 'AAC', 'ac-4.02.01.01')

  const verdict = judgeChannelOrder(await measure(page))

  expect(verdict.result).toBe('did not play')
  expect(verdict.findings.join(' ')).toContain('manifestIncompatibleCodecsError')
})
