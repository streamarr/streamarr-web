import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Request,
  type Route,
} from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { STUB_URL } from './ports'

// When the server replaces the stream session that plays, the player attaches the new one where
// the viewer was. This spec plays a synthetic stream through hls.js in Chromium and records each
// media segment that each stream session is asked for.

test.use({ viewport: { width: 1512, height: 850 }, serviceWorkers: 'block' })

const SEGMENT_SECONDS = 2
const SEGMENTS = 30
// Inside a segment, away from its edges.
const RESUME_SECONDS = 41
const SEGMENT_HOLDING_THE_RESUME_POINT = Math.floor(RESUME_SECONDS / SEGMENT_SECONDS)
// hls.js asks the first stream session for this segment soon after the seek, by when the server has
// replaced that stream session and answers 404.
const SEGMENT_PAST_THE_REPLACEMENT = SEGMENT_HOLDING_THE_RESUME_POINT + 2

// Each segment of the replacement takes this long to arrive, as on a slow link, so that hls.js asks
// for little more than the segments the first picture waits for.
const SLOW_SEGMENT_MS = 1_000

// VP9 in fMP4, which Playwright's Chromium decodes without proprietary codecs. The bandwidth it
// declares keeps hls.js 30 s ahead of the playhead, as with the server's streams, where the real
// bitrate would let hls.js load the whole stream at once.
const MULTIVARIANT = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=20000000,RESOLUTION=320x180,CODECS="vp09.00.21.08"',
  'stream.m3u8?t=playback-token',
  '',
].join('\n')

let streamDirectory: string

test.beforeAll(async () => {
  streamDirectory = await mkdtemp(join(tmpdir(), 'stream-session-handover-'))
  const frames = 24 * SEGMENT_SECONDS
  await promisify(execFile)('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-f', 'lavfi'],
    ...['-i', `testsrc2=size=320x180:rate=24:duration=${SEGMENTS * SEGMENT_SECONDS}`],
    ...['-c:v', 'libvpx-vp9', '-b:v', '200k', '-deadline', 'realtime', '-cpu-used', '8'],
    ...['-g', String(frames), '-keyint_min', String(frames), '-pix_fmt', 'yuv420p'],
    ...['-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod'],
    ...['-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4'],
    ...['-hls_segment_filename', join(streamDirectory, 'segment%d.m4s')],
    join(streamDirectory, 'stream.m3u8'),
  ])
})

// hls.js can still wait on a segment when a test ends, and answering it then reads a stream file
// that afterAll may have removed.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test.afterAll(async () => {
  await rm(streamDirectory, { recursive: true, force: true })
})

type StreamName = 'first' | 'replacement'

type PlaybackSession = ReturnType<typeof playbackSession>

function playbackSession(stream: StreamName) {
  return {
    id: 'playback-1',
    formatAttemptCount: stream === 'first' ? 1 : 2,
    maximumFormatAttempts: 4,
    requestedChoice: 'AUTO',
    playbackChoice: 'AUTO',
    formatChange: null,
    offeredChoices: ['ORIGINAL', 'AUTO', 'HIGH_720P', 'MEDIUM_480P', 'LOW_360P'],
    currentFormatAttempt: {
      __typename: 'ReadyPlaybackFormatAttempt',
      streamSession: {
        __typename: 'HlsStreamSession',
        id: `sess-${stream}`,
        streamUrl: `/api/stream/${stream}/multivariant.m3u8?t=playback-token`,
        transcodeMode: 'VIDEO_TRANSCODE',
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

// Signs the viewer in and answers the player's operations with `playback()`, read each time the
// player creates or reads the playback session.
async function serveThePlaybackSession(
  page: Page,
  request: APIRequestContext,
  playback: () => PlaybackSession,
) {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', (route) => {
    const operations: Record<string, unknown> = {
      CreatePlaybackSession: {
        createPlaybackSession: { playbackSession: playback(), userErrors: [] },
      },
      PlaybackSession: { playbackSession: playback() },
      PlayerMediaTitle: { movie: { __typename: 'Movie', id: 'm1', title: 'Everlight' } },
      ReportStreamSessionTimeline: { reportStreamSessionTimeline: true },
      DestroyPlaybackSession: {
        destroyPlaybackSession: { playbackSessionId: 'playback-1', userErrors: [] },
      },
    }
    const data = operations[operationName(route.request())]
    return data ? route.fulfill({ json: { data } }) : route.continue()
  })
}

const STREAM_REQUEST = /\/api\/stream\/(first|replacement)\/([\w.]+)/

// The stream session that a stream request names, the file it asks for, and the file's number
// when it is a media segment.
function streamRequest(route: Route): { stream: StreamName; file: string; segment: number | null } {
  const [, stream, file] = STREAM_REQUEST.exec(route.request().url())!
  const segment = /^segment(\d+)\.m4s$/.exec(file)
  return { stream: stream as StreamName, file, segment: segment ? Number(segment[1]) : null }
}

// Answers with the multivariant playlist, or with the file FFmpeg wrote.
function answerFromTheStream(route: Route, file: string) {
  if (file === 'multivariant.m3u8') {
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: MULTIVARIANT })
  }
  return route.fulfill({
    contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
    path: join(streamDirectory, file),
  })
}

interface Handover {
  /** The media segments that hls.js asked each stream session for, by number, in order. */
  segments: Record<StreamName, number[]>
  /** Whether hls.js has asked for the replacement's multivariant playlist. */
  replacementRequested: boolean
}

// Serves a playback session whose first stream session ends once hls.js asks it for
// SEGMENT_PAST_THE_REPLACEMENT; from then on the playback status names the replacement.
// Neither multivariant playlist carries EXT-X-START: the first starts at the beginning, and the
// server writes none for the replacement once playback has moved from the start position.
async function serveAHandover(page: Page, request: APIRequestContext): Promise<Handover> {
  const handover: Handover = {
    segments: { first: [], replacement: [] },
    replacementRequested: false,
  }
  let current: StreamName = 'first'
  await serveThePlaybackSession(page, request, () => playbackSession(current))
  await page.route(STREAM_REQUEST, async (route) => {
    const { stream, file, segment } = streamRequest(route)
    if (file === 'multivariant.m3u8' && stream === 'replacement') {
      handover.replacementRequested = true
    }
    if (segment !== null) {
      handover.segments[stream].push(segment)
      if (stream === 'first' && segment === SEGMENT_PAST_THE_REPLACEMENT) {
        current = 'replacement'
        return route.fulfill({ status: 404 })
      }
      if (stream === 'replacement')
        await new Promise((resolve) => setTimeout(resolve, SLOW_SEGMENT_MS))
    }
    return answerFromTheStream(route, file)
  })
  return handover
}

// Whether the element shows the picture at `seconds` or later, with no seek under way.
async function showsAPictureFrom(page: Page, seconds: number): Promise<boolean> {
  return page
    .locator('video')
    .evaluate(
      (video: HTMLVideoElement, from) =>
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !video.seeking &&
        video.currentTime >= from,
      seconds,
    )
}

test('a replacement stream session is first asked for the segment that holds the resume point, and never for its first segment', async ({
  page,
  request,
}) => {
  const handover = await serveAHandover(page, request)
  await page.goto('/play/file-1?movie=m1')
  await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-disabled', 'false')

  // As the browser's own controls pause and seek, without the player. Paused, the playhead stays
  // where the viewer put it until the replacement shows its first picture.
  await page.locator('video').evaluate((video: HTMLVideoElement, seconds) => {
    video.pause()
    video.currentTime = seconds
  }, RESUME_SECONDS)

  await expect.poll(() => handover.replacementRequested).toBe(true)
  await expect.poll(() => showsAPictureFrom(page, RESUME_SECONDS)).toBe(true)
  const beforeTheFirstPicture = [...handover.segments.replacement]
  const asked = `the replacement was asked for segments ${beforeTheFirstPicture.join(', ')}`
  expect(beforeTheFirstPicture[0], asked).toBe(SEGMENT_HOLDING_THE_RESUME_POINT)
  expect(beforeTheFirstPicture, asked).not.toContain(0)
})
