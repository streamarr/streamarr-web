import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { routeLadderPlayback } from './ladderPlayback'

// Auto lets hls.js adapt among the variants the server lists, while Original and a fixed quality
// keep the one variant the server lists for them (streamarr/streamarr-web#29). These specs play a
// synthetic two-variant ladder through hls.js in Chromium and slow its segments down.

// The player starts on its own, so no press on Play races the browser's autoplay decision.
test.use({
  viewport: { width: 1512, height: 850 },
  serviceWorkers: 'block',
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
})

const SEGMENT_SECONDS = 2
// Longer than the 30 s that hls.js buffers ahead, so it keeps loading while the video plays.
const SEGMENTS = 30
// A segment of the large variant then takes longer to arrive than it lasts.
const SLOW_SEGMENT_MS = 3_000

interface Variant {
  name: 'large' | 'small'
  width: number
  height: number
  bitrate: string
  bandwidth: number
}

const LARGE: Variant = {
  name: 'large',
  width: 640,
  height: 360,
  bitrate: '1200k',
  bandwidth: 1_500_000,
}
const SMALL: Variant = {
  name: 'small',
  width: 320,
  height: 180,
  bitrate: '200k',
  bandwidth: 300_000,
}

// VP9 in fMP4, which Playwright's Chromium decodes without proprietary codecs.
const CODECS = 'vp09.00.21.08'

function streamInf({ name, width, height, bandwidth }: Variant): string[] {
  return [
    `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${height},CODECS="${CODECS}"`,
    `${name}/stream.m3u8?t=playback-token`,
  ]
}

// Auto lists every variant, largest first; Original and a fixed quality list one.
function multivariant(variants: readonly Variant[]): string {
  return ['#EXTM3U', ...variants.flatMap(streamInf), ''].join('\n')
}

let streams: string

async function writeVariant({ name, width, height, bitrate }: Variant): Promise<void> {
  const frames = 24 * SEGMENT_SECONDS
  const directory = join(streams, name)
  await mkdir(directory)
  await promisify(execFile)('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-f', 'lavfi'],
    ...['-i', `testsrc2=size=${width}x${height}:rate=24:duration=${SEGMENTS * SEGMENT_SECONDS}`],
    ...['-c:v', 'libvpx-vp9', '-b:v', bitrate, '-deadline', 'realtime', '-cpu-used', '8'],
    ...['-g', String(frames), '-keyint_min', String(frames), '-pix_fmt', 'yuv420p'],
    ...['-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod'],
    ...['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'],
    ...['-hls_segment_filename', join(directory, 'segment%d.m4s'), join(directory, 'stream.m3u8')],
  ])
}

test.beforeAll(async () => {
  streams = await mkdtemp(join(tmpdir(), 'quality-hold-'))
  await writeVariant(LARGE)
  await writeVariant(SMALL)
})

test.afterAll(async () => {
  await rm(streams, { recursive: true, force: true })
})

/** One media segment that hls.js asked for. */
interface SegmentRequest {
  variant: Variant['name']
  /** The segment's number; it starts at this number times SEGMENT_SECONDS. */
  index: number
  /** Whether the route held the segment back before answering. */
  slowed: boolean
}

interface Ladder {
  /** Each media segment hls.js asked for, in order. */
  segments: SegmentRequest[]
  /** Each playback-session mutation the player sent, in order; reads of its status are left out. */
  mutations: string[]
}

interface LadderRoutes {
  choice: string
  variants: readonly Variant[]
  /** How many segments of the large variant arrive at once before every later one slows down. */
  fastLargeSegments: number
}

// Serves a playback session in `choice` whose multivariant playlist lists `variants`. Records each
// segment hls.js asks for and each playback-session mutation the player sends.
async function serveLadder(
  page: Page,
  request: APIRequestContext,
  { choice, variants, fastLargeSegments }: LadderRoutes,
): Promise<Ladder> {
  const ladder: Ladder = {
    segments: [],
    mutations: await routeLadderPlayback(page, request, {
      choice,
      transcodeMode: choice === 'ORIGINAL' ? 'REMUX' : 'VIDEO_TRANSCODE',
    }),
  }
  await page.route('**/api/stream/ladder/multivariant.m3u8*', (route) =>
    route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: multivariant(variants) }),
  )
  await page.route(/\/api\/stream\/ladder\/(large|small)\/([\w.]+)/, async (route) => {
    const [, variant, file] = /\/(large|small)\/([\w.]+)/.exec(route.request().url())!
    if (file.startsWith('segment')) {
      const largeSegments = ladder.segments.filter((loaded) => loaded.variant === 'large').length
      const slowed = variant === 'large' && largeSegments >= fastLargeSegments
      ladder.segments.push({
        variant: variant as Variant['name'],
        index: Number(/\d+/.exec(file)?.[0]),
        slowed,
      })
      if (slowed) {
        await new Promise((resolve) => setTimeout(resolve, SLOW_SEGMENT_MS))
      }
    }
    return route.fulfill({
      contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
      path: join(streams, variant, file),
    })
  })
  return ladder
}

async function playedSeconds(page: Page): Promise<number> {
  return page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)
}

function variantsOf(segments: readonly SegmentRequest[]): string[] {
  return segments.map((segment) => segment.variant)
}

test('Auto stays on the large variant while its segments arrive fast', async ({
  page,
  request,
}) => {
  const ladder = await serveLadder(page, request, {
    choice: 'AUTO',
    variants: [LARGE, SMALL],
    fastLargeSegments: Infinity,
  })

  await page.goto('/play/file-1?movie=m1')

  await expect.poll(() => ladder.segments.length, { timeout: 30_000 }).toBeGreaterThan(10)
  const fromLarge = variantsOf(ladder.segments).slice(variantsOf(ladder.segments).indexOf('large'))
  expect(new Set(fromLarge)).toEqual(new Set(['large']))
})

// hls.js would otherwise start below a first-listed variant that peaks above 5 Mb/s.
for (const large of [LARGE, { ...LARGE, bandwidth: 20_000_000 }]) {
  test(`Auto starts on the large variant listed at ${large.bandwidth} b/s, and drops to the small one once its segments arrive slower than they play`, async ({
    page,
    request,
  }) => {
    const ladder = await serveLadder(page, request, {
      choice: 'AUTO',
      variants: [large, SMALL],
      fastLargeSegments: 2,
    })

    await page.goto('/play/file-1?movie=m1')

    const firstSmallAfterASlowedLarge = () => {
      const slowed = ladder.segments.findIndex((segment) => segment.slowed)
      return ladder.segments.find(
        (segment, position) => slowed !== -1 && position > slowed && segment.variant === 'small',
      )
    }
    await expect.poll(firstSmallAfterASlowedLarge, { timeout: 30_000 }).toBeDefined()
    const small = firstSmallAfterASlowedLarge()!
    // The element plays into the small variant's first segment.
    await expect
      .poll(() => playedSeconds(page), { timeout: 30_000 })
      .toBeGreaterThan(small.index * SEGMENT_SECONDS + 1)
    await expect(page.getByRole('button', { name: 'Quality: Auto' })).toBeVisible()
    expect(ladder.segments[0].variant).toBe('large')
    expect(ladder.mutations).toEqual(['CreatePlaybackSession'])
  })
}

for (const { choice, label } of [
  { choice: 'ORIGINAL', label: 'Original' },
  { choice: 'HIGH_720P', label: '720p' },
]) {
  test(`${label} keeps its one variant and stays selected while its segments arrive slowly`, async ({
    page,
    request,
  }) => {
    const ladder = await serveLadder(page, request, {
      choice,
      variants: [LARGE],
      fastLargeSegments: 0,
    })

    await page.goto('/play/file-1?movie=m1')

    await expect.poll(() => playedSeconds(page), { timeout: 30_000 }).toBeGreaterThan(6)
    await expect(page.getByRole('button', { name: `Quality: ${label}` })).toBeVisible()
    expect(new Set(variantsOf(ladder.segments))).toEqual(new Set(['large']))
    expect(ladder.mutations).toEqual(['CreatePlaybackSession'])
  })
}
