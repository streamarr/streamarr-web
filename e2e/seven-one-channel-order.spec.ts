import { expect, test, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  type ChannelOrderResult,
} from './sevenOneChannelOrder'

// A browser declares 8 channels for an audio codec only when its decoder hands a 7.1 stream to the
// audio graph in the right order (streamarr/streamarr-web#29). This spec plays a synthetic 7.1
// stream in each codec that can carry 7.1 to a browser, and fails when the result differs from the
// one recorded for this browser and platform in seven-one-channel-order.md.

const CODECS = Object.keys(CODEC_FIXTURES) as ChannelOrderCodec[]
const PLATFORMS: Partial<Record<NodeJS.Platform, string>> = { darwin: 'macOS', linux: 'Linux' }

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
    (url) => url.pathname === SEVEN_ONE_PAGE_PATH,
    (route) => route.fulfill({ contentType: 'text/html', body: SEVEN_ONE_PAGE }),
  )
  await page.route(
    (url) => url.pathname === `${SEVEN_ONE_STREAM_PATH}/multivariant.m3u8`,
    (route) =>
      route.fulfill({
        contentType: 'application/vnd.apple.mpegurl',
        body: sevenOneMultivariant(codecs),
      }),
  )
  await page.route(
    (url) => SEVEN_ONE_STREAM_FILE.test(url.pathname),
    (route) => {
      const [, file] = SEVEN_ONE_STREAM_FILE.exec(new URL(route.request().url()).pathname)!
      return route.fulfill({ path: join(streams, codec, file) })
    },
  )
}

async function measure(page: Page, query = ''): Promise<ChannelOrderMeasurement> {
  await page.goto(
    `${SEVEN_ONE_PAGE_PATH}?stream=${SEVEN_ONE_STREAM_PATH}/multivariant.m3u8${query}`,
  )
  await page.getByRole('button', { name: 'Start' }).click()
  return page.evaluate(() => window.channelOrder!)
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
    ).toBe(await recordedChannelOrderResult(row.browser, row.platform, codec))
  })
}

test('a stream that hls.js cannot play is judged as not played', async ({ page }) => {
  // hls.js stops with a fatal error on a playlist no browser decodes, while play() still waits.
  await serveStream(page, 'AAC', 'ac-4.02.01.01')

  const verdict = judgeChannelOrder(await measure(page))

  expect(verdict.result).toBe('did not play')
  expect(verdict.findings.join(' ')).toContain('manifestIncompatibleCodecsError')
})

test('a stream that stops arriving is judged as not played once the deadline passes', async ({
  page,
}) => {
  await serveStream(page, 'FLAC')
  // The media segment never arrives.
  await page.route(
    (url) => url.pathname.endsWith('/segment0.m4s'),
    () => undefined,
  )

  const verdict = judgeChannelOrder(await measure(page, '&deadline=2'))

  expect(verdict.result).toBe('did not play')
  expect(verdict.findings[0]).toMatch(/^Playback did not reach the end within 2 s/)
})
