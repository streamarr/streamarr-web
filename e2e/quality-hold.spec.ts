import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { STUB_URL } from './ports'

// Auto lets hls.js adapt among the variants the server lists, while Original and a fixed quality
// keep the one variant the server lists for them (streamarr/streamarr-web#29). These specs play a
// synthetic two-variant ladder through hls.js in Chromium and slow its segments down.

test.use({ viewport: { width: 1512, height: 850 }, serviceWorkers: 'block' })

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

function playbackSession(choice: string) {
  return {
    id: 'playback-1',
    formatAttemptCount: 1,
    maximumFormatAttempts: 4,
    requestedChoice: choice,
    playbackChoice: choice,
    formatChange: null,
    offeredChoices: ['ORIGINAL', 'AUTO', 'HIGH_720P', 'MEDIUM_480P', 'LOW_360P'],
    currentFormatAttempt: {
      __typename: 'ReadyPlaybackFormatAttempt',
      streamSession: {
        __typename: 'HlsStreamSession',
        id: 'sess-1',
        streamUrl: '/api/stream/ladder/multivariant.m3u8?t=playback-token',
        transcodeMode: choice === 'ORIGINAL' ? 'REMUX' : 'VIDEO_TRANSCODE',
        videoRange: 'SDR',
        mediaEndSeconds: null,
      },
    },
  }
}

function operationName(call: Request): string {
  const body = call.postDataJSON() as { operationName?: string } | null
  return body?.operationName ?? ''
}

interface Ladder {
  /** The variant of each media segment hls.js asked for, in order. */
  segments: string[]
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
  const ladder: Ladder = { segments: [], mutations: [] }
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  const operations: Record<string, unknown> = {
    CreatePlaybackSession: {
      createPlaybackSession: { playbackSession: playbackSession(choice), userErrors: [] },
    },
    PlaybackSession: { playbackSession: playbackSession(choice) },
    PlayerMediaTitle: { movie: { __typename: 'Movie', id: 'm1', title: 'Everlight' } },
    ReportStreamSessionTimeline: { reportStreamSessionTimeline: true },
    DestroyPlaybackSession: {
      destroyPlaybackSession: { playbackSessionId: 'playback-1', userErrors: [] },
    },
  }
  await page.route('**/graphql', async (route) => {
    const name = operationName(route.request())
    if (name.includes('Playback') && name !== 'PlaybackSession') ladder.mutations.push(name)
    const data = operations[name]
    return data ? route.fulfill({ json: { data } }) : route.continue()
  })
  await page.route('**/api/stream/ladder/multivariant.m3u8*', (route) =>
    route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: multivariant(variants) }),
  )
  await page.route(/\/api\/stream\/ladder\/(large|small)\/([\w.]+)/, async (route) => {
    const [, variant, file] = /\/(large|small)\/([\w.]+)/.exec(route.request().url())!
    if (file.startsWith('segment')) {
      ladder.segments.push(variant)
      const largeSegments = ladder.segments.filter((loaded) => loaded === 'large').length
      if (variant === 'large' && largeSegments > fastLargeSegments) {
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

// The browser may refuse to start a page opened from its address. Then the viewer presses Play.
async function openAndPlay(page: Page): Promise<void> {
  await page.goto('/play/file-1?movie=m1')
  const play = page.getByRole('button', { name: 'Play', exact: true })
  const isPaused = () => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)
  await expect
    .poll(async () => !(await isPaused()) || (await play.isEnabled().catch(() => false)), {
      // The first page of a run waits for Vite to compile the player.
      timeout: 30_000,
    })
    .toBe(true)
  if (await isPaused()) {
    await play.click()
  }
}

async function playedSeconds(page: Page): Promise<number> {
  return page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)
}

test('Auto climbs to the large variant and drops to the small one when its segments slow down', async ({
  page,
  request,
}) => {
  const ladder = await serveLadder(page, request, {
    choice: 'AUTO',
    variants: [LARGE, SMALL],
    fastLargeSegments: 1,
  })

  await openAndPlay(page)

  await expect.poll(() => ladder.segments.indexOf('large'), { timeout: 30_000 }).not.toBe(-1)
  await expect
    .poll(() => ladder.segments.slice(ladder.segments.indexOf('large')).includes('small'), {
      timeout: 30_000,
    })
    .toBe(true)
  await expect(page.getByRole('button', { name: 'Quality: Auto' })).toBeVisible()
  expect(ladder.mutations).toEqual(['CreatePlaybackSession'])
})

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

    await openAndPlay(page)

    await expect.poll(() => playedSeconds(page), { timeout: 30_000 }).toBeGreaterThan(6)
    await expect(page.getByRole('button', { name: `Quality: ${label}` })).toBeVisible()
    expect(new Set(ladder.segments)).toEqual(new Set(['large']))
    expect(ladder.mutations).toEqual(['CreatePlaybackSession'])
  })
}
