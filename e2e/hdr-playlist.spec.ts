import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test'
import { fileURLToPath } from 'node:url'
import type {
  ClientCapabilityDeclarationInput,
  CreatePlaybackSessionMutationVariables,
} from '../src/graphql/generated/graphql'
import { paintedText, textContrast } from './contrast'
import { STUB_URL } from './ports'

// The player gives hls.js a video preference built from its declaration. These specs play a PQ
// stream through hls.js in a real engine: two seconds of synthetic 10-bit AV1 tagged BT.2020 and
// PQ, from e2e/fixtures/pq/generate.sh.

test.use({ viewport: { width: 1512, height: 850 }, serviceWorkers: 'block' })

const PQ_CODECS = 'av01.0.04M.10.0.110.09.16.09.0'
const SDR_CODECS = 'av01.0.04M.08'

// As the server writes an HDR copy: every variant has the source's PQ range.
const PQ_ONLY_MULTIVARIANT = [
  '#EXTM3U',
  `#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,FRAME-RATE=24.000,CODECS="${PQ_CODECS}",VIDEO-RANGE=PQ`,
  'pq-360.m3u8?t=playback-token',
  `#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,FRAME-RATE=24.000,CODECS="${PQ_CODECS}",VIDEO-RANGE=PQ`,
  'pq-360-low.m3u8?t=playback-token',
  '',
].join('\n')

// Beyond what the server writes: one ladder with an SDR and a PQ variant, so the preference alone
// decides which variant hls.js starts on.
const SDR_AND_PQ_MULTIVARIANT = [
  '#EXTM3U',
  `#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,FRAME-RATE=24.000,CODECS="${SDR_CODECS}",VIDEO-RANGE=SDR`,
  'sdr-360.m3u8?t=playback-token',
  `#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,FRAME-RATE=24.000,CODECS="${PQ_CODECS}",VIDEO-RANGE=PQ`,
  'pq-360.m3u8?t=playback-token',
  '',
].join('\n')

const MEDIA_PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-TARGETDURATION:2',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXT-X-MAP:URI="init.mp4"',
  '#EXTINF:2.0,',
  'segment0.m4s',
  '#EXT-X-ENDLIST',
  '',
].join('\n')

const PQ_SESSION = {
  createPlaybackSession: {
    playbackSession: {
      id: 'playback-pq',
      formatAttemptCount: 1,
      maximumFormatAttempts: 4,
      requestedChoice: 'AUTO',
      playbackChoice: 'AUTO',
      formatChange: null,
      offeredChoices: ['ORIGINAL', 'AUTO', 'MEDIUM_480P', 'LOW_360P'],
      decisions: [],
      currentFormatAttempt: {
        __typename: 'ReadyPlaybackFormatAttempt',
        streamSession: {
          __typename: 'HlsStreamSession',
          id: 'sess-pq',
          streamUrl: '/api/stream/pq/multivariant.m3u8?t=playback-token',
          transcodeMode: 'REMUX',
          videoRange: 'PQ',
          mediaEndSeconds: null,
        },
      },
    },
    userErrors: [],
  },
}

// A playback of the PQ source whose Quality menu shows the HDR toggle.
interface HdrSourcePlayback {
  choice: 'ORIGINAL' | 'MEDIUM_480P'
  /** The choice's label on the quality button. */
  label: string
  /** The range of the stream that plays. */
  videoRange: 'PQ' | 'SDR'
  displaysHdr: boolean
  /** The toggle this playback shows. */
  toggle: { on: boolean; unavailable: boolean }
}

// Original keeps the source's range, so the viewer cannot turn its HDR off.
const ORIGINAL: HdrSourcePlayback = {
  choice: 'ORIGINAL',
  label: 'Original',
  videoRange: 'PQ',
  displaysHdr: true,
  toggle: { on: true, unavailable: true },
}

// A fixed quality takes the viewer's HDR choice.
const FIXED_QUALITY_IN_HDR: HdrSourcePlayback = {
  choice: 'MEDIUM_480P',
  label: '480p',
  videoRange: 'PQ',
  displaysHdr: true,
  toggle: { on: true, unavailable: false },
}

function sessionOf({ choice, videoRange }: HdrSourcePlayback) {
  const { playbackSession } = PQ_SESSION.createPlaybackSession
  const { streamSession } = playbackSession.currentFormatAttempt
  return {
    createPlaybackSession: {
      ...PQ_SESSION.createPlaybackSession,
      playbackSession: {
        ...playbackSession,
        playbackChoice: choice,
        decisions: [{ video: { source: { videoRange: 'PQ' } } }],
        currentFormatAttempt: {
          ...playbackSession.currentFormatAttempt,
          streamSession: { ...streamSession, videoRange },
        },
      },
    },
  }
}

const OPERATIONS: Record<string, unknown> = {
  CreatePlaybackSession: PQ_SESSION,
  PlayerMediaTitle: {
    episode: {
      __typename: 'Episode',
      id: 'e1',
      title: 'Breakage',
      episodeNumber: 5,
      season: {
        __typename: 'Season',
        id: 'season-2',
        seasonNumber: 2,
        series: { __typename: 'Series', id: 'series-1', title: 'Northern Line' },
      },
    },
  },
  ReportStreamSessionTimeline: { reportStreamSessionTimeline: true },
  DestroyPlaybackSession: {
    destroyPlaybackSession: { playbackSessionId: 'playback-pq', userErrors: [] },
  },
}

function operationName(call: Request): string {
  const body = call.postDataJSON() as { operationName?: string } | null
  return body?.operationName ?? ''
}

// The display answers the media queries the declaration and hls.js read as `highDynamicRange` says.
async function onDisplay(page: Page, highDynamicRange: boolean): Promise<void> {
  await page.addInitScript((matches) => {
    const matchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query) =>
      query.includes('dynamic-range') ? { ...matchMedia(query), matches } : matchMedia(query)
  }, highDynamicRange)
}

interface PlayedStream {
  declarations: ClientCapabilityDeclarationInput[]
  mediaPlaylists: string[]
}

// Serves the PQ stream session with `multivariant`, and answers every media playlist and segment
// with the PQ fixtures. Records each declaration the player sends and each media playlist it loads.
async function servePqStream(
  page: Page,
  request: APIRequestContext,
  multivariant: string,
): Promise<PlayedStream> {
  const played: PlayedStream = { declarations: [], mediaPlaylists: [] }
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const name = operationName(route.request())
    if (name === 'CreatePlaybackSession') {
      const { variables } = route.request().postDataJSON() as {
        variables: CreatePlaybackSessionMutationVariables
      }
      played.declarations.push(variables.input.capabilities)
    }
    const data = OPERATIONS[name]
    return data ? route.fulfill({ json: { data } }) : route.continue()
  })
  await page.route('**/api/stream/pq/multivariant.m3u8*', (route) =>
    route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: multivariant }),
  )
  await page.route(/\/api\/stream\/pq\/(sdr|pq)-[\w-]+\.m3u8/, (route) => {
    played.mediaPlaylists.push(new URL(route.request().url()).pathname.split('/').pop() ?? '')
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: MEDIA_PLAYLIST })
  })
  for (const [segment, fixture] of [
    ['init.mp4', 'initialization-segment.mp4'],
    ['segment0.m4s', 'media-segment.m4s'],
  ]) {
    const path = fileURLToPath(new URL(`fixtures/pq/${fixture}`, import.meta.url))
    await page.route(`**/api/stream/pq/${segment}*`, (route) =>
      route.fulfill({ contentType: 'video/mp4', path }),
    )
  }
  return played
}

function declaresPq(declaration: ClientCapabilityDeclarationInput): boolean {
  return declaration.video.some((entry) => entry.hls && entry.compatibleBases.includes('PQ'))
}

// The element has decoded the stream's first frame at the picture's size.
async function expectFirstPqFrame(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator('video').evaluate((video: HTMLVideoElement) => ({
        decoded: video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
        width: video.videoWidth,
        height: video.videoHeight,
        error: video.error?.code ?? null,
      })),
    )
    .toEqual({ decoded: true, width: 640, height: 360, error: null })
}

test('a PQ-only ladder plays through hls.js on a display that shows HDR', async ({
  page,
  request,
}) => {
  await onDisplay(page, true)
  const played = await servePqStream(page, request, PQ_ONLY_MULTIVARIANT)

  await page.goto('/play/file-1?episode=e1')

  await expectFirstPqFrame(page)
  expect(played.declarations.map(declaresPq)).toEqual([true])
  expect(played.mediaPlaylists[0]).toBe('pq-360.m3u8')
})

test('a PQ-only ladder still plays through hls.js when the declaration lists only SDR', async ({
  page,
  request,
}) => {
  await onDisplay(page, false)
  const played = await servePqStream(page, request, PQ_ONLY_MULTIVARIANT)

  await page.goto('/play/file-1?episode=e1')

  await expectFirstPqFrame(page)
  expect(played.declarations.map(declaresPq)).toEqual([false])
})

test('hls.js starts on the range the declaration prefers when a ladder lists SDR and PQ', async ({
  page,
  request,
}) => {
  await onDisplay(page, true)
  const onHdrDisplay = await servePqStream(page, request, SDR_AND_PQ_MULTIVARIANT)
  await page.goto('/play/file-1?episode=e1')
  await expect.poll(() => onHdrDisplay.mediaPlaylists.length).toBeGreaterThan(0)

  const sdrPage = await page.context().newPage()
  await onDisplay(sdrPage, false)
  const onSdrDisplay = await servePqStream(sdrPage, request, SDR_AND_PQ_MULTIVARIANT)
  await sdrPage.goto('/play/file-1?episode=e1')
  await expect.poll(() => onSdrDisplay.mediaPlaylists.length).toBeGreaterThan(0)

  expect(onHdrDisplay.mediaPlaylists[0]).toBe('pq-360.m3u8')
  expect(onSdrDisplay.mediaPlaylists[0]).toBe('sdr-360.m3u8')
})

// Plays the PQ source as `playback` says and opens the Quality menu, whose last row is the HDR
// toggle in the state `playback` names.
async function openQualityMenu(
  page: Page,
  request: APIRequestContext,
  playback: HdrSourcePlayback,
): Promise<{ menu: Locator; toggle: Locator }> {
  await onDisplay(page, playback.displaysHdr)
  await servePqStream(page, request, PQ_ONLY_MULTIVARIANT)
  await page.route('**/graphql', (route) =>
    operationName(route.request()) === 'CreatePlaybackSession'
      ? route.fulfill({ json: { data: sessionOf(playback) } })
      : route.fallback(),
  )
  await page.goto('/play/file-1?episode=e1')
  await page.getByRole('button', { name: `Quality: ${playback.label}` }).click()
  const menu = page.getByRole('menu', { name: 'Quality' })
  const toggle = menu.getByRole('menuitemcheckbox', { name: /^HDR/ })
  await expect(toggle).toHaveAttribute('aria-checked', String(playback.toggle.on))
  expect(await toggle.getAttribute('aria-disabled')).toBe(
    playback.toggle.unavailable ? 'true' : null,
  )
  return { menu, toggle }
}

test('the HDR toggle that Original holds on keeps its highlight under the pointer', async ({
  page,
  request,
}) => {
  const { menu, toggle } = await openQualityMenu(page, request, ORIGINAL)
  const highlight = await menu
    .getByRole('menuitemradio', { checked: true })
    .evaluate((row) => getComputedStyle(row).backgroundColor)
  await expect(toggle).toHaveCSS('background-color', highlight)

  await toggle.hover()

  await expect(toggle).toHaveCSS('background-color', highlight)
})

test('the HDR toggle that Original holds on keeps its label readable, at rest and under the pointer', async ({
  page,
  request,
}) => {
  const { toggle } = await openQualityMenu(page, request, ORIGINAL)
  const label = toggle.getByText('HDR', { exact: true })
  const underThePointer = () => toggle.evaluate((row) => row.matches(':hover'))
  expect(await underThePointer()).toBe(false)

  const atRest = textContrast(await paintedText(label))
  await toggle.hover()
  expect(await underThePointer()).toBe(true)
  const hovered = textContrast(await paintedText(label))

  expect.soft(atRest, 'at rest').toBeGreaterThanOrEqual(4.5)
  expect(hovered, 'under the pointer').toBeGreaterThanOrEqual(4.5)
})

test('the HDR toggle that Original holds on reads apart from a choice the viewer can change', async ({
  page,
  request,
}) => {
  const { menu, toggle } = await openQualityMenu(page, request, ORIGINAL)
  const original = menu.getByRole('menuitemradio', { checked: true })
  const weight = (row: Locator) =>
    row.evaluate((element) => Number(getComputedStyle(element).fontWeight))

  expect(await weight(toggle)).toBeLessThan(await weight(original))
  await expect(original).toHaveCSS('cursor', 'pointer')
  await expect(toggle).toHaveCSS('cursor', 'default')
})

// An icon on a selected row takes the row's own color, whether or not the viewer can change the row.
for (const [held, playback] of [
  ['Original holds on', ORIGINAL],
  ['the viewer can turn off', FIXED_QUALITY_IN_HDR],
] as const) {
  test(`the HDR toggle that ${held} draws its check in its label's color`, async ({
    page,
    request,
  }) => {
    const { toggle } = await openQualityMenu(page, request, playback)
    const color = (part: Locator) => part.evaluate((element) => getComputedStyle(element).color)

    expect(await color(toggle.locator('svg'))).toBe(
      await color(toggle.getByText('HDR', { exact: true })),
    )
  })
}

// Forced colors remove every row's fill, so the check is the mark that is left to show HDR is on.
test('the HDR toggle that Original holds on keeps its check when the system forces its colors', async ({
  page,
  request,
}) => {
  const { toggle } = await openQualityMenu(page, request, ORIGINAL)
  const check = toggle.locator('svg')

  for (const palette of ['light', 'dark'] as const) {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: palette })
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)

    expect
      .soft(textContrast(await paintedText(check)), `in a ${palette} forced palette`)
      .toBeGreaterThanOrEqual(3)
  }
})
