import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type {
  ClientCapabilityDeclarationInput,
  DeclaredCompatibleBase,
  ReportPlaybackFormatFailureInput,
  SourceContainer,
  SwitchPlaybackAudioTrackInput,
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

const TWO_AUDIO_TRACKS_FILE = 'h264-avc1-two-audio-tracks.mp4'
const TWO_AUDIO_TRACKS_PATH = '/direct-play-fixtures/two-audio-tracks.mp4'

// Of Playwright's engines, only WebKit lists a file's audio tracks on the media element by default.
const SELECTS_AUDIO_TRACK: Record<string, boolean> = {
  chromium: false,
  firefox: false,
  webkit: true,
}

// Declares, then turns on the second of a file's two audio tracks in a media element, plays it, and
// reads which of the tracks the element lists are on.
async function switchToTheSecondAudioTrack(page: Page) {
  await page.route('**/direct-play-fixtures', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Direct play</title>' }),
  )
  await page.route(`**${TWO_AUDIO_TRACKS_PATH}`, (route) =>
    serveFile(route, fixturePath(TWO_AUDIO_TRACKS_FILE), 'video/mp4'),
  )
  await page.goto('/direct-play-fixtures')
  return page.evaluate(
    async ({ path, src }) => {
      const capabilities = (await import(/* @vite-ignore */ path)) as Capabilities
      const declaration = await capabilities.declarePlaybackCapabilities(
        capabilities.browserPlaybackPlatform(document.createElement('video')),
      )
      const video = document.createElement('video')
      video.muted = true
      // WebKit lists the file's audio tracks after its metadata and before its first frame.
      const loaded = new Promise((resolve) =>
        video.addEventListener('loadeddata', resolve, { once: true }),
      )
      video.src = src
      document.body.append(video)
      await loaded
      // lib.dom declares no audioTracks.
      const list = Reflect.get(video, 'audioTracks') as ArrayLike<{ enabled: boolean }> | undefined
      const tracks = list ? Array.from(list) : []
      tracks.forEach((track, index) => {
        track.enabled = index === 1
      })
      const played = new Promise<boolean>((resolve) => {
        const deadline = setTimeout(() => resolve(false), 10_000)
        video.addEventListener('timeupdate', () => {
          if (video.currentTime > 0) {
            clearTimeout(deadline)
            resolve(true)
          }
        })
      })
      void video.play().catch(() => undefined)
      return {
        declared: declaration.selectsAudioTrackInDirectPlay,
        played: await played,
        enabled: tracks.map((track) => track.enabled),
      }
    },
    { path: CAPABILITIES_MODULE, src: TWO_AUDIO_TRACKS_PATH },
  )
}

test('the engine declares that it selects an audio track only where it switches a file to another one', async ({
  page,
  browserName,
}) => {
  const answer = await switchToTheSecondAudioTrack(page)

  const selects = SELECTS_AUDIO_TRACK[browserName]
  expect(answer).toEqual({
    declared: selects,
    played: true,
    enabled: selects ? [false, true] : [],
  })
})

// Firefox lists audio tracks behind media.track.enabled, but only one of a file's two. The other
// engines ignore the preference.
const TRACKS_ENABLED_WITH_FIREFOX_TRACK_PREFERENCE: Record<string, boolean[]> = {
  chromium: [],
  firefox: [false],
  webkit: [false, true],
}

test('the engine declares that it selects an audio track only where it switches a file to another one, with Firefox listing audio tracks', async ({
  browserName,
  browser,
  baseURL,
}) => {
  const preferring = await browser.browserType().launch({
    firefoxUserPrefs: { 'media.track.enabled': true },
  })
  try {
    const page = await preferring.newPage({ baseURL })

    const answer = await switchToTheSecondAudioTrack(page)

    expect(answer).toEqual({
      declared: SELECTS_AUDIO_TRACK[browserName],
      played: true,
      enabled: TRACKS_ENABLED_WITH_FIREFOX_TRACK_PREFERENCE[browserName],
    })
  } finally {
    await preferring.close()
  }
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
    decisions: [],
    currentFormatAttempt: { __typename: 'ReadyPlaybackFormatAttempt', streamSession },
  }
}

const DIRECT_PLAY_STREAM = {
  __typename: 'DirectPlayStreamSession',
  id: 'sess-1',
  streamUrl: SOURCE_FILE_URL,
  sourceContainer: 'MP4',
  videoRange: 'SDR',
  startPositionSeconds: null,
  audioTrackPosition: 0,
  audioTracks: [{ position: 0, language: null, title: null }],
}

const DIRECT_PLAY_SESSION = readyPlaybackSession(DIRECT_PLAY_STREAM)

// The two-track fixture's audio tracks as the server lists them: English, the default, then French.
const TWO_AUDIO_TRACKS = [
  { position: 0, language: 'eng', title: null },
  { position: 1, language: 'fre', title: null },
]

function twoAudioTrackDirectPlaySession(audioTrackPosition: number) {
  return readyPlaybackSession({
    __typename: 'DirectPlayStreamSession',
    id: 'sess-1',
    streamUrl: SOURCE_FILE_URL,
    sourceContainer: 'MP4',
    videoRange: 'SDR',
    startPositionSeconds: null,
    audioTrackPosition,
    audioTracks: TWO_AUDIO_TRACKS,
  })
}

const HLS_SESSION = readyPlaybackSession({
  __typename: 'HlsStreamSession',
  id: 'sess-1',
  streamUrl: MULTIVARIANT_URL,
  transcodeMode: 'REMUX',
  videoRange: 'SDR',
  mediaEndSeconds: null,
})

// As the server decides for the two-track file when the stream decision chooses the track at
// `chosen` (ADR 0045, decision A18): a player that cannot select a track plays the file's first,
// default track, so it direct-plays the file only when that track is the chosen one.
function twoAudioTrackFileSession(chosen: number) {
  return (capabilities: ClientCapabilityDeclarationInput) =>
    capabilities.selectsAudioTrackInDirectPlay || chosen === 0
      ? twoAudioTrackDirectPlaySession(chosen)
      : HLS_SESSION
}

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
  SwitchPlaybackAudioTrack: {
    switchPlaybackAudioTrack: { playbackSession: HLS_FALLBACK_SESSION, userErrors: [] },
  },
  PlayerMediaTitle: {
    movie: { __typename: 'Movie', id: 'file-1', title: 'Everlight' },
  },
  ReportStreamSessionTimeline: { reportStreamSessionTimeline: true },
  DestroyPlaybackSession: {
    destroyPlaybackSession: { playbackSessionId: 'playback-1', userErrors: [] },
  },
}

// Opens the player on the playback session `playbackSessionFor` answers for the declaration the
// player sends, a direct-play session unless it says otherwise, with a source file that
// `serveSource` answers, and returns each format failure the player reports. Each audio track
// switch the player asks for lands in `switches`, and the server answers it with HLS.
async function openDirectPlay(
  page: Page,
  request: APIRequestContext,
  {
    serveSource,
    playbackSessionFor = () => DIRECT_PLAY_SESSION,
    switches = [],
    resumePosition,
  }: {
    serveSource: (route: Route) => Promise<void>
    playbackSessionFor?: (capabilities: ClientCapabilityDeclarationInput) => unknown
    switches?: SwitchPlaybackAudioTrackInput[]
    resumePosition?: number
  },
): Promise<ReportPlaybackFormatFailureInput[]> {
  const reports: ReportPlaybackFormatFailureInput[] = []
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const body = route.request().postDataJSON() as {
      operationName?: string
      variables?: {
        input?: ReportPlaybackFormatFailureInput & {
          capabilities?: ClientCapabilityDeclarationInput
        }
      }
    } | null
    const operationName = body?.operationName ?? ''
    const input = body?.variables?.input
    if (operationName === 'ReportPlaybackFormatFailure' && input) {
      reports.push(input)
    }
    if (operationName === 'SwitchPlaybackAudioTrack' && input) {
      switches.push(input as unknown as SwitchPlaybackAudioTrackInput)
    }
    if (operationName === 'CreatePlaybackSession' && input?.capabilities) {
      const playbackSession = playbackSessionFor(input.capabilities)
      return route.fulfill({
        json: { data: { createPlaybackSession: { playbackSession, userErrors: [] } } },
      })
    }
    const data = PLAYER_OPERATIONS[operationName]
    return data ? route.fulfill({ json: { data } }) : route.continue()
  })
  await page.route('**/api/stream/e2e/source.mp4*', serveSource)
  const position = resumePosition === undefined ? '' : `&position=${resumePosition}`
  await page.goto(`/play/file-1?movie=file-1${position}`)
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
  await openDirectPlay(page, request, {
    serveSource: (route) => serveFile(route, fixturePath('h264-avc1.mp4'), 'video/mp4'),
  })

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

test('the player plays the source file of a resumed title from the start position its stream session names', async ({
  page,
  request,
}) => {
  await openDirectPlay(page, request, {
    serveSource: (route) => serveFile(route, fixturePath('h264-avc1.mp4'), 'video/mp4'),
    playbackSessionFor: () =>
      readyPlaybackSession({ ...DIRECT_PLAY_STREAM, startPositionSeconds: 0.5 }),
    resumePosition: 0.5,
  })

  const video = page.locator('video')
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) =>
        element.played.length > 0 ? element.played.start(0) : null,
      ),
    )
    .toBe(0.5)
})

test('the player reports a source file it cannot open and starts the HLS fallback', async ({
  page,
  request,
}) => {
  const fallbackRequested = page.waitForRequest((sent) => sent.url().includes(MULTIVARIANT_URL))
  await page.route('**/api/stream/e2e-fallback/**', (route) => route.abort())

  const reports = await openDirectPlay(page, request, {
    serveSource: (route) =>
      route.fulfill({ contentType: 'video/mp4', body: 'This is not a media file.' }),
  })

  await fallbackRequested
  expect(reports).toEqual([
    { playbackSessionId: 'playback-1', streamSessionId: 'sess-1', reason: 'UNSUPPORTED_FORMAT' },
  ])
})

test('the player shows the failure without a format attempt when the source file answers 404', async ({
  page,
  request,
}) => {
  const reports = await openDirectPlay(page, request, {
    serveSource: (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }),
  })

  await expect(page.getByRole('alert')).toContainText("Playback couldn't start.")
  expect(reports).toEqual([])
})

// What the player has done with a file of two audio tracks so far.
async function twoAudioTrackPlayback(page: Page, requested: readonly string[]) {
  const enabled = await page
    .locator('video')
    .evaluate((element: HTMLVideoElement) =>
      Array.from(
        (Reflect.get(element, 'audioTracks') as ArrayLike<{ enabled: boolean }> | undefined) ?? [],
      ).map((track) => track.enabled),
    )
  return {
    playlistRequested: requested.some((url) => url.includes(MULTIVARIANT_URL)),
    sourceFileRequested: requested.some((url) => url.includes('/api/stream/e2e/source.mp4')),
    enabled,
    frenchShown: await page.getByRole('button', { name: 'Audio: French' }).isVisible(),
  }
}

test('the player plays a file with two audio tracks on the named track where the engine selects one, and over HLS elsewhere', async ({
  page,
  request,
  browserName,
}) => {
  const requested: string[] = []
  page.on('request', (sent) => requested.push(sent.url()))
  await page.route('**/api/stream/e2e-fallback/**', (route) => route.abort())

  await openDirectPlay(page, request, {
    serveSource: (route) => serveFile(route, fixturePath(TWO_AUDIO_TRACKS_FILE), 'video/mp4'),
    playbackSessionFor: twoAudioTrackFileSession(1),
  })

  const directPlay = {
    playlistRequested: false,
    sourceFileRequested: true,
    enabled: [false, true],
    frenchShown: true,
  }
  const hls = {
    playlistRequested: true,
    sourceFileRequested: false,
    enabled: [],
    frenchShown: false,
  }
  await expect
    .poll(() => twoAudioTrackPlayback(page, requested))
    .toEqual(SELECTS_AUDIO_TRACK[browserName] ? directPlay : hls)
})

test('every engine plays a file with two audio tracks directly when its first track is the chosen one', async ({
  page,
  request,
  browserName,
}) => {
  const requested: string[] = []
  page.on('request', (sent) => requested.push(sent.url()))
  await page.route('**/api/stream/e2e-fallback/**', (route) => route.abort())

  await openDirectPlay(page, request, {
    serveSource: (route) => serveFile(route, fixturePath(TWO_AUDIO_TRACKS_FILE), 'video/mp4'),
    playbackSessionFor: twoAudioTrackFileSession(0),
  })

  await expect
    .poll(() => twoAudioTrackPlayback(page, requested))
    .toEqual({
      playlistRequested: false,
      sourceFileRequested: true,
      // Only WebKit lists the file's tracks, and English plays there too.
      enabled: SELECTS_AUDIO_TRACK[browserName] ? [true, false] : [],
      frenchShown: false,
    })
  await expect(page.getByRole('button', { name: 'Audio: English' })).toBeVisible()
})

test('choosing another audio track during direct play moves to HLS where the engine cannot select one, and switches the track in the file where it can', async ({
  page,
  request,
  browserName,
}) => {
  const requested: string[] = []
  page.on('request', (sent) => requested.push(sent.url()))
  await page.route('**/api/stream/e2e-fallback/**', (route) => route.abort())
  const switches: SwitchPlaybackAudioTrackInput[] = []
  await openDirectPlay(page, request, {
    serveSource: (route) => serveFile(route, fixturePath(TWO_AUDIO_TRACKS_FILE), 'video/mp4'),
    playbackSessionFor: twoAudioTrackFileSession(0),
    switches,
  })
  const video = page.locator('video')
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2)

  await page.getByRole('button', { name: 'Audio: English' }).click()
  await expect(page.getByRole('menuitemradio')).toHaveText(['English', 'French'])
  await page.getByRole('menuitemradio', { name: 'French' }).click()

  if (SELECTS_AUDIO_TRACK[browserName]) {
    await expect
      .poll(() => twoAudioTrackPlayback(page, requested))
      .toEqual({
        playlistRequested: false,
        sourceFileRequested: true,
        enabled: [false, true],
        frenchShown: true,
      })
    expect(switches).toEqual([])
    return
  }
  await expect.poll(() => requested.some((url) => url.includes(MULTIVARIANT_URL))).toBe(true)
  expect(switches).toEqual([
    { playbackSessionId: 'playback-1', streamSessionId: 'sess-1', audioTrackPosition: 1 },
  ])
})
