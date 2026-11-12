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
// the viewer was, and a stream session attached again past its real end starts where its playlist
// does. A startup past a real end that no status has named yet ends playback at that real end.
// This spec plays a synthetic stream through hls.js in Chromium and records each media segment
// that each stream session is asked for.

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

// Where a copy that ran short of its playlist's advertised end really ends.
const REAL_END_SECONDS = 30
const FIRST_SEGMENT_PAST_THE_REAL_END = REAL_END_SECONDS / SEGMENT_SECONDS
// Past the real end, where the viewer's first seek ends playback.
const ENDED_SECONDS = 35
// A startup past a real end that no status names yet reads the status after 3 s. This bound leaves
// room for that read and for the page's own start, and stays far short of the player's 30 s
// startup deadline.
const ENDED_WITHIN_MS = 10_000

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

function playbackSession(
  stream: StreamName,
  { mediaEndSeconds = null }: { mediaEndSeconds?: number | null } = {},
) {
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
        mediaEndSeconds,
      },
    },
  }
}

function operationName(call: Request): string {
  const body = call.postDataJSON() as { operationName?: string } | null
  return body?.operationName ?? ''
}

interface TimelineReport {
  sessionId: string
  positionSeconds: number
  state: string
}

// Signs the viewer in and answers the player's operations with `playback()`, read each time the
// player creates or reads the playback session. Returns the timeline reports the player sends.
async function serveThePlaybackSession(
  page: Page,
  request: APIRequestContext,
  playback: () => PlaybackSession,
): Promise<TimelineReport[]> {
  const reports: TimelineReport[] = []
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', (route) => {
    if (operationName(route.request()) === 'ReportStreamSessionTimeline') {
      const body = route.request().postDataJSON() as { variables: TimelineReport }
      reports.push(body.variables)
    }
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
  return reports
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

// Serves a playback session whose stream session's copy ran short at REAL_END_SECONDS, as the
// server names it from the start. As the server does, it never answers a request for a segment past
// that end. Returns the media segments hls.js asked for, by number, in order, each time the player
// attached the stream session.
async function serveACopyThatRanShort(page: Page, request: APIRequestContext): Promise<number[][]> {
  const attaches: number[][] = []
  await serveThePlaybackSession(page, request, () =>
    playbackSession('first', { mediaEndSeconds: REAL_END_SECONDS }),
  )
  await page.route(STREAM_REQUEST, async (route) => {
    const { file, segment } = streamRequest(route)
    if (file === 'multivariant.m3u8') attaches.push([])
    if (segment === null) return answerFromTheStream(route, file)
    attaches.at(-1)?.push(segment)
    // Left unanswered, as the server holds it.
    if (segment >= FIRST_SEGMENT_PAST_THE_REAL_END) return
    return answerFromTheStream(route, file)
  })
  return attaches
}

// The server learns where a short copy really ends only once a job attempt runs past that end, so
// its status names the real end only after hls.js has asked for a segment past it. As the server
// does, it never answers that request.
function unnamedRealEnd() {
  let named = false
  return {
    /** Whether to hold the request for `segment`; the status names the real end from then on. */
    holdsPast: (segment: number): boolean => {
      if (segment < FIRST_SEGMENT_PAST_THE_REAL_END) return false
      named = true
      return true
    },
    mediaEndSeconds: (): number | null => (named ? REAL_END_SECONDS : null),
  }
}

// Serves a handover as serveAHandover does, without the slow link, to a replacement whose copy ran
// short at REAL_END_SECONDS, an end that no status has named yet. Returns the timeline reports.
async function serveAHandoverPastAnUnnamedRealEnd(
  page: Page,
  request: APIRequestContext,
): Promise<{ reports: TimelineReport[]; handover: Handover }> {
  const handover: Handover = {
    segments: { first: [], replacement: [] },
    replacementRequested: false,
  }
  const realEnd = unnamedRealEnd()
  let current: StreamName = 'first'
  const reports = await serveThePlaybackSession(page, request, () =>
    playbackSession(current, {
      mediaEndSeconds: current === 'replacement' ? realEnd.mediaEndSeconds() : null,
    }),
  )
  await page.route(STREAM_REQUEST, async (route) => {
    const { stream, file, segment } = streamRequest(route)
    if (file === 'multivariant.m3u8' && stream === 'replacement') {
      handover.replacementRequested = true
    }
    if (segment === null) return answerFromTheStream(route, file)
    handover.segments[stream].push(segment)
    if (stream === 'first' && segment === SEGMENT_PAST_THE_REPLACEMENT) {
      current = 'replacement'
      return route.fulfill({ status: 404 })
    }
    if (stream === 'replacement' && realEnd.holdsPast(segment)) return
    return answerFromTheStream(route, file)
  })
  return { reports, handover }
}

// Serves a new playback session that starts at RESUME_SECONDS, which the server marks with
// EXT-X-START, and whose copy ran short at REAL_END_SECONDS, an end that no status has named yet.
// Returns the timeline reports.
async function serveAStartPastAnUnnamedRealEnd(
  page: Page,
  request: APIRequestContext,
): Promise<TimelineReport[]> {
  const realEnd = unnamedRealEnd()
  const reports = await serveThePlaybackSession(page, request, () =>
    playbackSession('first', { mediaEndSeconds: realEnd.mediaEndSeconds() }),
  )
  await page.route(STREAM_REQUEST, async (route) => {
    const { file, segment } = streamRequest(route)
    if (file === 'multivariant.m3u8') {
      return route.fulfill({
        contentType: 'application/vnd.apple.mpegurl',
        body: MULTIVARIANT.replace(
          '#EXTM3U\n',
          `#EXTM3U\n#EXT-X-START:TIME-OFFSET=${RESUME_SECONDS},PRECISE=YES\n`,
        ),
      })
    }
    if (segment !== null && realEnd.holdsPast(segment)) return
    return answerFromTheStream(route, file)
  })
  return reports
}

function stoppedReports(reports: TimelineReport[]): TimelineReport[] {
  return reports.filter((report) => report.state === 'STOPPED')
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

test('a stream session attached again as the viewer plays past its real end loads from its first segment, not from one the server holds', async ({
  page,
  request,
}) => {
  const attaches = await serveACopyThatRanShort(page, request)
  await page.goto('/play/file-1?movie=m1')
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)

  // As the browser's own controls seek, without the player. A seek past the real end ends playback
  // there. Play after an end at the real end attaches the stream session again, from the top while
  // the playhead stays where playback ended, so the viewer first seeks further.
  const seekTo = (seconds: number) =>
    video.evaluate((element: HTMLVideoElement, to) => {
      element.currentTime = to
    }, seconds)
  await seekTo(ENDED_SECONDS)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await seekTo(RESUME_SECONDS)
  await page.getByRole('button', { name: 'Play' }).click()

  await expect.poll(() => attaches[1]?.length ?? 0).toBeGreaterThan(0)
  const asked = `the stream session attached again was asked for segments ${attaches[1]?.join(', ')}`
  expect(attaches[1]?.[0], asked).toBe(0)
  await expect
    .poll(() =>
      video.evaluate(
        (element: HTMLVideoElement) => element.readyState >= HTMLMediaElement.HAVE_METADATA,
      ),
    )
    .toBe(true)
})

test('a replacement attached past a real end that no status has named yet ends playback at the real end, long before the startup deadline', async ({
  page,
  request,
}) => {
  const { reports, handover } = await serveAHandoverPastAnUnnamedRealEnd(page, request)
  await page.goto('/play/file-1?movie=m1')
  await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-disabled', 'false')
  await page.locator('video').evaluate((video: HTMLVideoElement, seconds) => {
    video.pause()
    video.currentTime = seconds
  }, RESUME_SECONDS)
  await expect.poll(() => handover.replacementRequested).toBe(true)

  await expect
    .poll(() => stoppedReports(reports), { timeout: ENDED_WITHIN_MS })
    .toEqual([
      { sessionId: 'sess-replacement', positionSeconds: REAL_END_SECONDS, state: 'STOPPED' },
    ])
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(handover.segments.replacement[0]).toBe(SEGMENT_HOLDING_THE_RESUME_POINT)
})

test('a first load at a start position past a real end that no status has named yet ends playback at the real end, long before the startup deadline', async ({
  page,
  request,
}) => {
  const reports = await serveAStartPastAnUnnamedRealEnd(page, request)

  await page.goto(`/play/file-1?movie=m1&position=${RESUME_SECONDS}`)

  await expect
    .poll(() => stoppedReports(reports), { timeout: ENDED_WITHIN_MS })
    .toEqual([{ sessionId: 'sess-first', positionSeconds: REAL_END_SECONDS, state: 'STOPPED' }])
  await expect(page.getByRole('alert')).toHaveCount(0)
})
