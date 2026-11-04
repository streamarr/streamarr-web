import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type {
  ClientCapabilityDeclarationInput,
  DeclaredCompatibleBase,
  ReportPlaybackFormatFailureInput,
  SourceContainer,
  VideoSampleEntry,
} from '../src/graphql/generated/graphql'
import { STUB_URL } from './ports'

// The unit tests answer the declaration's direct-play questions with fakes. This spec asks each
// engine the real questions, then hands its media element a real file for each container and
// sample entry, so a value the engine declares but cannot play fails here. The files come from
// e2e/fixtures/direct-play/generate.sh. It never retries, so a crash fails it too.

test.describe.configure({ retries: 0 })
test.use({ serviceWorkers: 'block' })

type Capabilities = typeof import('../src/streaming/playbackCapabilities')

// Vite's dev server serves the module that the player imports.
const CAPABILITIES_MODULE = '/src/streaming/playbackCapabilities.ts'

interface Fixture {
  file: string
  container: SourceContainer
  codecFamily: string
  // Only an MP4 file names its video's coding format with a sample entry.
  sampleEntry?: VideoSampleEntry
  audioCodec: string
  // SDR unless the file carries HDR.
  compatibleBase?: DeclaredCompatibleBase
}

const FIXTURES: readonly Fixture[] = [
  {
    file: 'h264-avc1.mp4',
    container: 'MP4',
    codecFamily: 'H264',
    sampleEntry: 'AVC1',
    audioCodec: 'AAC',
  },
  {
    file: 'h264-avc3.mp4',
    container: 'MP4',
    codecFamily: 'H264',
    sampleEntry: 'AVC3',
    audioCodec: 'AAC',
  },
  {
    file: 'hevc-hvc1.mp4',
    container: 'MP4',
    codecFamily: 'HEVC',
    sampleEntry: 'HVC1',
    audioCodec: 'AAC',
  },
  {
    file: 'hevc-hvc1-pq.mp4',
    container: 'MP4',
    codecFamily: 'HEVC',
    sampleEntry: 'HVC1',
    audioCodec: 'AAC',
    compatibleBase: 'PQ',
  },
  {
    file: 'hevc-hev1.mp4',
    container: 'MP4',
    codecFamily: 'HEVC',
    sampleEntry: 'HEV1',
    audioCodec: 'AAC',
  },
  {
    file: 'av1-av01.mp4',
    container: 'MP4',
    codecFamily: 'AV1',
    sampleEntry: 'AV01',
    audioCodec: 'OPUS',
  },
  { file: 'av1.webm', container: 'MATROSKA', codecFamily: 'AV1', audioCodec: 'OPUS' },
]

// As the server sends each container. A WebM file is Matroska, served as source.mkv.
const MEDIA_TYPES: Partial<Record<SourceContainer, string>> = {
  MP4: 'video/mp4',
  MATROSKA: 'video/x-matroska',
}

function servedPath(fixture: Fixture): string {
  return `/direct-play-fixtures/${fixture.file.replace(/\.webm$/, '.mkv')}`
}

function fixturePath(file: string): string {
  return fileURLToPath(new URL(`fixtures/direct-play/${file}`, import.meta.url))
}

// Answers byte-range requests as the server's source file endpoint does, so each engine reads the
// file the way it reads one there.
async function serveFile(route: Route, path: string, contentType: string): Promise<void> {
  const body = await readFile(path)
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers()['range'] ?? '')
  if (!range) {
    return route.fulfill({
      status: 200,
      body,
      headers: { 'content-type': contentType, 'accept-ranges': 'bytes' },
    })
  }
  const start = Number(range[1])
  const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1)
  return route.fulfill({
    status: 206,
    body: body.subarray(start, end + 1),
    headers: {
      'content-type': contentType,
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${body.length}`,
    },
  })
}

function declares(declaration: ClientCapabilityDeclarationInput, fixture: Fixture): boolean {
  const video = declaration.video.some(
    (entry) =>
      entry.codecFamily === fixture.codecFamily &&
      entry.compatibleBases.includes(fixture.compatibleBase ?? 'SDR') &&
      (entry.directPlayContainers ?? []).includes(fixture.container) &&
      (fixture.sampleEntry === undefined ||
        (entry.directPlaySampleEntries ?? []).includes(fixture.sampleEntry)),
  )
  const audio = declaration.audio.some(
    (entry) =>
      entry.codec === fixture.audioCodec &&
      (entry.directPlayContainers ?? []).includes(fixture.container),
  )
  return video && audio
}

// Resolves whether the element played past the file's start before its error or the deadline.
function playsInTheMediaElement(page: Page, url: string): Promise<string> {
  return page.evaluate(
    (src) =>
      new Promise<string>((resolve) => {
        const video = document.createElement('video')
        video.muted = true
        const deadline = setTimeout(() => resolve('no frame within 10 s'), 10_000)
        video.addEventListener('timeupdate', () => {
          if (video.currentTime > 0) {
            clearTimeout(deadline)
            resolve('played')
          }
        })
        video.addEventListener('error', () => {
          clearTimeout(deadline)
          resolve(`MediaError ${video.error?.code}`)
        })
        video.src = src
        document.body.append(video)
        void video.play().catch(() => undefined)
      }),
    url,
  )
}

test('the media element plays every file whose container and sample entry the engine declares', async ({
  page,
}, testInfo) => {
  await page.route('**/direct-play-fixtures', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Direct play</title>' }),
  )
  for (const fixture of FIXTURES) {
    await page.route(`**${servedPath(fixture)}`, (route) =>
      serveFile(route, fixturePath(fixture.file), MEDIA_TYPES[fixture.container] ?? ''),
    )
  }
  await page.goto('/direct-play-fixtures')

  const declaration = await page.evaluate(async (path) => {
    const capabilities = (await import(/* @vite-ignore */ path)) as Capabilities
    return capabilities.declarePlaybackCapabilities(
      capabilities.browserPlaybackPlatform(document.createElement('video')),
    )
  }, CAPABILITIES_MODULE)
  const results: Record<string, { declared: boolean; played: string }> = {}
  for (const fixture of FIXTURES) {
    results[fixture.file] = {
      declared: declares(declaration, fixture),
      played: await playsInTheMediaElement(page, servedPath(fixture)),
    }
  }

  await testInfo.attach('direct-play.json', {
    body: JSON.stringify({ results, declaration }, null, 2),
    contentType: 'application/json',
  })
  const declaredButNotPlayed = Object.entries(results).filter(
    ([, { declared, played }]) => declared && played !== 'played',
  )
  expect(declaredButNotPlayed).toEqual([])
  // Every engine plays H.264 from an avc1 MP4, so a declaration without it lost its answers.
  expect(results['h264-avc1.mp4'].declared).toBe(true)
})

const SOURCE_FILE_URL = '/api/stream/e2e/source.mp4?t=playback-token'
const MULTIVARIANT_URL = '/api/stream/e2e-fallback/multivariant.m3u8?t=playback-token'

function readyPlaybackSession(streamSession: Record<string, unknown>) {
  return {
    __typename: 'PlaybackSession',
    id: 'playback-1',
    formatAttemptCount: 1,
    maximumFormatAttempts: 4,
    requestedChoice: 'ORIGINAL',
    playbackChoice: 'ORIGINAL',
    formatChange: null,
    offeredChoices: ['ORIGINAL', 'AUTO'],
    currentFormatAttempt: { __typename: 'ReadyPlaybackFormatAttempt', streamSession },
  }
}

const DIRECT_PLAY_SESSION = readyPlaybackSession({
  __typename: 'DirectPlayStreamSession',
  id: 'sess-1',
  streamUrl: SOURCE_FILE_URL,
  sourceContainer: 'MP4',
  videoRange: 'SDR',
})

const HLS_FALLBACK_SESSION = {
  ...readyPlaybackSession({
    __typename: 'HlsStreamSession',
    id: 'sess-2',
    streamUrl: MULTIVARIANT_URL,
    transcodeMode: 'REMUX',
    videoRange: 'SDR',
    mediaEndSeconds: null,
  }),
  formatAttemptCount: 2,
}

const PLAYER_OPERATIONS: Record<string, unknown> = {
  CreatePlaybackSession: {
    createPlaybackSession: { playbackSession: DIRECT_PLAY_SESSION, userErrors: [] },
  },
  ReportPlaybackFormatFailure: {
    reportPlaybackFormatFailure: { playbackSession: HLS_FALLBACK_SESSION, userErrors: [] },
  },
  PlayerMediaTitle: {
    movie: { __typename: 'Movie', id: 'file-1', title: 'Everlight' },
  },
  ReportStreamSessionTimeline: { reportStreamSessionTimeline: true },
  DestroyPlaybackSession: {
    destroyPlaybackSession: { playbackSessionId: 'playback-1', userErrors: [] },
  },
}

// Opens the player on a direct-play session whose source file `serveSource` answers, and returns
// each format failure the player reports.
async function openDirectPlay(
  page: Page,
  request: APIRequestContext,
  serveSource: (route: Route) => Promise<void>,
): Promise<ReportPlaybackFormatFailureInput[]> {
  const reports: ReportPlaybackFormatFailureInput[] = []
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const body = route.request().postDataJSON() as {
      operationName?: string
      variables?: { input?: ReportPlaybackFormatFailureInput }
    } | null
    const operationName = body?.operationName ?? ''
    if (operationName === 'ReportPlaybackFormatFailure' && body?.variables?.input) {
      reports.push(body.variables.input)
    }
    const data = PLAYER_OPERATIONS[operationName]
    return data ? route.fulfill({ json: { data } }) : route.continue()
  })
  await page.route('**/api/stream/e2e/source.mp4*', serveSource)
  await page.goto('/play/file-1?movie=file-1')
  return reports
}

test('the player plays a direct-play session from its source file without HLS', async ({
  page,
  request,
}) => {
  const playlistRequests: string[] = []
  page.on('request', (sent) => {
    if (sent.url().includes('.m3u8')) playlistRequests.push(sent.url())
  })
  await openDirectPlay(page, request, (route) =>
    serveFile(route, fixturePath('h264-avc1.mp4'), 'video/mp4'),
  )

  const video = page.locator('video')
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2)
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentSrc)).toContain(
    SOURCE_FILE_URL,
  )
  expect(playlistRequests).toEqual([])
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('the player reports a source file it cannot open and starts the HLS fallback', async ({
  page,
  request,
}) => {
  const fallbackRequested = page.waitForRequest((sent) => sent.url().includes(MULTIVARIANT_URL))
  await page.route('**/api/stream/e2e-fallback/**', (route) => route.abort())

  const reports = await openDirectPlay(page, request, (route) =>
    route.fulfill({ contentType: 'video/mp4', body: 'This is not a media file.' }),
  )

  await fallbackRequested
  expect(reports).toEqual([
    { playbackSessionId: 'playback-1', streamSessionId: 'sess-1', reason: 'UNSUPPORTED_FORMAT' },
  ])
})
