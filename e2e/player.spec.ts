import {
  expect,
  test,
  type APIRequestContext,
  type ConsoleMessage,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { selectedProfileState } from '../src/test/selectedProfileStateFixture'
import { RING, ringOnActiveElement } from './focusRing'
import { STUB_URL } from './ports'

// The session's stream is 47:04 long, and its media never arrives: the playlists answer and every
// segment request hangs. Each spec ends well inside the player's 30-second startup deadline.
test.use({ viewport: { width: 1512, height: 850 }, serviceWorkers: 'block' })

// As the server writes it: one audio rendition, muxed into the variant, and no subtitles.
const MULTIVARIANT = [
  '#EXTM3U',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2"',
  '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio"',
  'stream.m3u8?t=playback-token',
  '',
].join('\n')

// Beyond what the server writes today: a choice of audio and a subtitle group, so the pickers meet
// hls.js itself.
const MULTIVARIANT_WITH_TRACKS = [
  '#EXTM3U',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="audio-en.m3u8?t=playback-token"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Français",LANGUAGE="fr",DEFAULT=NO,AUTOSELECT=YES,URI="audio-fr.m3u8?t=playback-token"',
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="de",DEFAULT=NO,AUTOSELECT=YES,URI="audio-de.m3u8?t=playback-token"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English (SDH)",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="subtitles-en.m3u8?t=playback-token"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Español",LANGUAGE="es",DEFAULT=NO,AUTOSELECT=YES,URI="subtitles-es.m3u8?t=playback-token"',
  '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio",SUBTITLES="subs"',
  'stream.m3u8?t=playback-token',
  '',
].join('\n')

function levelPlaylist(durationSeconds: number): string {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${durationSeconds}`,
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-MAP:URI="init.mp4"',
    `#EXTINF:${durationSeconds}.0,`,
    'segment0.m4s',
    '#EXT-X-ENDLIST',
    '',
  ].join('\n')
}

// As the server writes it for a stream session with a start position: EXT-X-START marks the
// position before the renditions and variants.
function multivariantStartingAt(startPositionSeconds: number | undefined): string {
  if (startPositionSeconds === undefined) return MULTIVARIANT
  return MULTIVARIANT.replace(
    '#EXTM3U\n',
    `#EXTM3U\n#EXT-X-START:TIME-OFFSET=${startPositionSeconds},PRECISE=YES\n`,
  )
}

// Six-second segments, as the server's default target duration cuts them.
function segmentedLevelPlaylist(durationSeconds: number): string {
  const segments = Array.from({ length: Math.ceil(durationSeconds / 6) }, (_, index) => [
    `#EXTINF:${Math.min(6, durationSeconds - index * 6)}.0,`,
    `segment${index}.m4s`,
  ])
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-MAP:URI="init.mp4"',
    ...segments.flat(),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n')
}

function createdStartPosition(call: Request): number | undefined {
  const body = call.postDataJSON() as {
    variables?: { input?: { startPositionSeconds?: number } }
  } | null
  return body?.variables?.input?.startPositionSeconds
}

interface PlayerRoutes {
  operations?: Record<string, unknown>
  multivariant?: string
  durationSeconds?: number
  levelPlaylistAnswered?: Promise<void>
}

async function routePlayer(
  page: Page,
  request: APIRequestContext,
  {
    operations = {},
    multivariant = MULTIVARIANT,
    durationSeconds = 2824,
    levelPlaylistAnswered = Promise.resolve(),
  }: PlayerRoutes = {},
): Promise<void> {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const data = { ...PLAYER_OPERATIONS, ...operations }[operationName(route.request())]
    return data ? route.fulfill({ json: { data } }) : route.continue()
  })
  await page.route('**/api/stream/**/multivariant.m3u8*', (route) =>
    route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: multivariant }),
  )
  await page.route('**/api/stream/**/stream.m3u8*', async (route) => {
    await levelPlaylistAnswered
    return route.fulfill({
      contentType: 'application/vnd.apple.mpegurl',
      body: levelPlaylist(durationSeconds),
    })
  })
  await page.route(
    /\/api\/stream\/.*\/(audio|subtitles)-\w+\.m3u8/,
    () => new Promise(() => undefined),
  )
  await page.route(/\/api\/stream\/.*\.(mp4|m4s)/, () => new Promise(() => undefined))
}

const PLAYER_PATH = '/play/file-1?episode=e1'

async function openPlayer(
  page: Page,
  request: APIRequestContext,
  routes?: PlayerRoutes,
): Promise<void> {
  await routePlayer(page, request, routes)
  await page.goto(PLAYER_PATH)
  await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-disabled', 'false')
}

function operationName(call: Request): string {
  const body = call.postDataJSON() as { operationName?: string } | null
  return body?.operationName ?? ''
}

const PLAYER_OPERATIONS: Record<string, unknown> = {
  CreatePlaybackSession: {
    createPlaybackSession: {
      playbackSession: {
        id: 'playback-1',
        formatAttemptCount: 1,
        maximumFormatAttempts: 4,
        requestedChoice: 'AUTO',
        playbackChoice: 'AUTO',
        formatChange: null,
        offeredChoices: ['ORIGINAL', 'AUTO', 'HIGH_720P', 'MEDIUM_480P', 'LOW_360P'],
        currentFormatAttempt: {
          __typename: 'ReadyPlaybackFormatAttempt',
          streamSession: {
            __typename: 'HlsStreamSession',
            id: 'sess-1',
            streamUrl: '/api/stream/e2e/multivariant.m3u8?t=playback-token',
            transcodeMode: 'REMUX',
            videoRange: 'SDR',
            mediaEndSeconds: null,
          },
        },
      },
      userErrors: [],
    },
  },
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
    destroyPlaybackSession: { playbackSessionId: 'playback-1', userErrors: [] },
  },
}

const CAPACITY_REFUSAL = {
  createPlaybackSession: {
    playbackSession: null,
    userErrors: [
      {
        __typename: 'TranscodeCapacityUnavailableError',
        message: 'Every transcode slot is busy. Try again in a moment.',
      },
    ],
  },
}

// A movie whose detail page has a Play link to the player's media file.
const MOVIE_DETAIL = {
  movie: {
    __typename: 'Movie',
    id: 'm1',
    title: 'Everlight',
    tagline: null,
    summary: null,
    runtime: 142,
    releaseDate: '2024-05-10',
    contentRating: null,
    genres: [],
    directors: [],
    cast: [],
    ratings: [],
    files: [{ id: 'file-1' }],
    selectedProfileState: selectedProfileState(),
    backdropImages: [],
    posterImages: [],
  },
}

// Ten seconds of black 720p H.264 and silent stereo AAC, as the variant's CODECS declare. hls.js
// appends the initialization segment only with the first media segment, and only then does the
// element load its metadata, where the player asks it to play.
async function serveTheFirstMediaSegment(
  page: Page,
  segmentsAnswered = Promise.resolve(),
): Promise<void> {
  for (const [segment, fixture] of [
    ['init.mp4', 'initialization-segment.mp4'],
    ['segment0.m4s', 'media-segment.m4s'],
  ]) {
    const path = fileURLToPath(new URL(`fixtures/${fixture}`, import.meta.url))
    await page.route(`**/api/stream/**/${segment}*`, async (route) => {
      await segmentsAnswered
      return route.fulfill({ contentType: 'video/mp4', path })
    })
  }
}

// The click on the movie's Play link lets the player start playback without a press on Play.
async function openPlayerFromThePlayLink(page: Page, request: APIRequestContext): Promise<void> {
  await routePlayer(page, request, { operations: { MovieDetail: MOVIE_DETAIL } })
  await serveTheFirstMediaSegment(page)
  await page.goto('/movie/m1')
  await page.getByRole('link', { name: 'Play' }).click()
}

// Every query Playwright makes of the page counts as user activation, so a spec learns from the
// console, not from the page, that the element has loaded its metadata. The page logs the message
// while it dispatches the event, so the player has handled the event before the spec's next query.
async function watchForLoadedMetadata(page: Page): Promise<{ loaded: Promise<ConsoleMessage> }> {
  await page.addInitScript(() => {
    const announce = () => console.info('loadedmetadata')
    document.addEventListener('loadedmetadata', announce, { capture: true })
  })
  return {
    loaded: page.waitForEvent('console', (message) => message.text() === 'loadedmetadata'),
  }
}

// Presses Tab once for each control, and checks that focus lands on each control in turn.
async function tabThrough(page: Page, controls: Locator[]): Promise<void> {
  for (const control of controls) {
    await page.keyboard.press('Tab')
    await expect(control).toBeFocused()
  }
}

async function videoPaused(page: Page): Promise<boolean> {
  return page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)
}

// Opacity does not inherit, so a control's own style never shows that its container faded.
async function renderedOpacity(control: Locator): Promise<number> {
  return control.evaluate((element) => {
    let opacity = 1
    for (let node: Element | null = element; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return opacity
  })
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function tapAcross(page: Page, control: Locator, fraction: number) {
  const box = await control.boundingBox()
  expect(box, String(control)).not.toBeNull()
  const { x, y, width, height } = box as Box
  await page.touchscreen.tap(x + width * fraction, y + height / 2)
}

// A mouse still clicks and focuses an aria-disabled button, which Playwright's click refuses as
// disabled. Hovering waits for the button to be visible, stable and unobscured instead.
async function clickAriaDisabled(page: Page, control: Locator) {
  await control.hover()
  await page.mouse.down()
  await page.mouse.up()
}

function sliderTrack(page: Page, name: string): Locator {
  return page
    .locator('.mantine-Slider-trackContainer')
    .filter({ has: page.getByRole('slider', { name }) })
}

async function centreY(control: Locator): Promise<number> {
  const box = await control.boundingBox()
  expect(box, String(control)).not.toBeNull()
  const { y, height } = box as Box
  return y + height / 2
}

async function popoverPlacement(menu: Locator) {
  return menu.evaluate((node) => {
    const surface = node.parentElement
    if (!surface) {
      throw new Error('the menu has no popover around it')
    }
    const box = surface.getBoundingClientRect()
    const caretLeft = Number.parseFloat(getComputedStyle(surface, '::after').left)
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      caretX: box.left + surface.clientLeft + caretLeft,
    }
  })
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

async function truncated(control: Locator): Promise<boolean> {
  return control.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const clippedBy = (ancestor: Element) => {
      const bounds = ancestor.getBoundingClientRect()
      const clips = getComputedStyle(ancestor).overflowX !== 'visible'
      return clips && (rect.left < bounds.left || rect.right > bounds.right)
    }
    const ancestors: Element[] = []
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      ancestors.push(parent)
    }
    const overflows = (element: Element) => element.scrollWidth > element.clientWidth
    return [node, ...node.querySelectorAll('*')].some(overflows) || ancestors.some(clippedBy)
  })
}

// The part of a control left on screen once every ancestor that clips its overflow has cut it.
async function paintedBox(control: Locator): Promise<Box> {
  return control.evaluate((node) => {
    const { left, right, top, height } = node.getBoundingClientRect()
    const painted = { left, right }
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowX === 'visible') {
        continue
      }
      const bounds = parent.getBoundingClientRect()
      painted.left = Math.max(painted.left, bounds.left)
      painted.right = Math.min(painted.right, bounds.right)
    }
    return { x: painted.left, y: top, width: Math.max(painted.right - painted.left, 0), height }
  })
}

async function expectControlsApart(page: Page, controls: Locator[]) {
  const viewport = page.viewportSize()
  const boxes: Box[] = []
  for (const control of controls) {
    const box = await control.boundingBox()
    expect(box, String(control)).not.toBeNull()
    boxes.push(box as Box)
    expect(await truncated(control), `${String(control)} is cut short`).toBe(false)
  }
  for (const [index, box] of boxes.entries()) {
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport?.width ?? 0)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport?.height ?? 0)
    for (const other of boxes.slice(index + 1)) {
      expect(overlap(box, other), `${String(controls[index])} overlaps another control`).toBe(false)
    }
  }
}

function barControls(page: Page): Locator[] {
  return [
    page.getByRole('heading', { level: 1, name: 'Northern Line' }),
    page.getByText('0:00 / 47:04'),
    page.getByRole('button', { name: 'Mute' }),
    page.getByRole('button', { name: 'Back 10 seconds' }),
    page.getByRole('button', { name: 'Play' }),
    page.getByRole('button', { name: 'Forward 10 seconds' }),
    page.getByRole('button', { name: 'Quality: Auto' }),
    page.getByRole('button', { name: 'Audio: Audio' }),
    page.getByRole('button', { name: 'Subtitles: Off' }),
    page.getByRole('button', { name: 'Settings' }),
    page.getByRole('button', { name: 'Full screen' }),
  ]
}

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('keyboard focus draws the theme ring on each player control', async ({ page, request }) => {
  await openPlayer(page, request)

  const controls = [
    page.getByRole('button', { name: 'Back', exact: true }),
    page.getByRole('slider', { name: 'Seek' }),
    page.getByRole('button', { name: 'Mute' }),
    page.getByRole('slider', { name: 'Volume' }),
    page.getByRole('button', { name: 'Back 10 seconds' }),
    page.getByRole('button', { name: 'Play' }),
    page.getByRole('button', { name: 'Forward 10 seconds' }),
    page.getByRole('button', { name: 'Quality: Auto' }),
    page.getByRole('button', { name: 'Audio: Audio' }),
    page.getByRole('button', { name: 'Subtitles: Off' }),
    page.getByRole('button', { name: 'Settings' }),
    page.getByRole('button', { name: 'Full screen' }),
  ]
  for (const control of controls) {
    await page.keyboard.press('Tab')
    await expect(control).toBeFocused()
    expect(await ringOnActiveElement(page)).toMatchObject(RING)
  }
})

test('the controls fade while playing untouched and return on pointer or keyboard', async ({
  page,
  request,
}) => {
  await openPlayer(page, request)
  const back = page.getByRole('button', { name: 'Back', exact: true })
  const pause = page.getByRole('button', { name: 'Pause' })

  await page.getByRole('button', { name: 'Play' }).click()
  await page.mouse.move(756, 200)
  await expect.poll(() => renderedOpacity(pause)).toBe(0)
  expect(await renderedOpacity(back)).toBe(0)

  await page.mouse.move(700, 240)
  await expect.poll(() => renderedOpacity(pause)).toBe(1)
  expect(await renderedOpacity(back)).toBe(1)

  await expect.poll(() => renderedOpacity(pause)).toBe(0)
  await page.keyboard.press('Shift')
  await expect.poll(() => renderedOpacity(pause)).toBe(1)
})

test('focus that lands on a faded control brings the controls back without a key press', async ({
  page,
  request,
}) => {
  await openPlayer(page, request)
  const back = page.getByRole('button', { name: 'Back', exact: true })
  const pause = page.getByRole('button', { name: 'Pause' })
  await page.getByRole('button', { name: 'Play' }).click()
  await page.mouse.move(756, 200)
  await expect.poll(() => renderedOpacity(pause)).toBe(0)

  await page.getByRole('button', { name: 'Mute' }).focus()

  await expect.poll(() => renderedOpacity(pause)).toBe(1)
  expect(await renderedOpacity(back)).toBe(1)
})

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true })

  test.beforeEach(async ({ page, request }) => {
    await openPlayer(page, request)
    await page.getByRole('button', { name: 'Play' }).tap()
    const back = page.getByRole('button', { name: 'Back', exact: true })
    await expect.poll(() => renderedOpacity(back)).toBe(0)
  })

  test('a tap on the faded controls brings them back and presses nothing', async ({ page }) => {
    const back = page.getByRole('button', { name: 'Back', exact: true })
    const pause = page.getByRole('button', { name: 'Pause' })

    await tapAcross(page, pause, 0.5)

    await expect.poll(() => renderedOpacity(back)).toBe(1)
    await expect(pause).toBeVisible()
    expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(
      false,
    )
  })

  test('a tap on the faded seek bar brings the controls back and seeks nowhere', async ({
    page,
  }) => {
    const back = page.getByRole('button', { name: 'Back', exact: true })

    await tapAcross(page, sliderTrack(page, 'Seek'), 0.75)

    await expect.poll(() => renderedOpacity(back)).toBe(1)
    expect(
      await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime),
    ).toBe(0)
  })

  test('a tap on the faded volume slider brings the controls back and changes nothing', async ({
    page,
  }) => {
    const back = page.getByRole('button', { name: 'Back', exact: true })

    await tapAcross(page, sliderTrack(page, 'Volume'), 0.25)

    await expect.poll(() => renderedOpacity(back)).toBe(1)
    expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.volume)).toBe(1)
  })
})

test('the buffering ring shows while the playing video waits for data', async ({
  page,
  request,
}) => {
  await openPlayer(page, request)

  await page.getByRole('button', { name: 'Play' }).click()

  const ring = page.getByRole('progressbar', { name: 'Buffering' })
  await expect(ring).toBeAttached()
  const box = await ring.boundingBox()
  expect(box && { x: box.x + box.width / 2, width: box.width }).toEqual({ x: 1512 / 2, width: 54 })
})

test('the player opened from a Play link starts playing without a press on Play', async ({
  page,
  request,
}) => {
  await openPlayerFromThePlayLink(page, request)

  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})

test('a resumed title asks first for the segment that holds the resume position, and never for the first segment', async ({
  page,
  request,
}) => {
  await routePlayer(page, request)
  let startPositionSeconds: number | undefined
  await page.route('**/graphql', (route) => {
    if (operationName(route.request()) === 'CreatePlaybackSession') {
      startPositionSeconds = createdStartPosition(route.request())
    }
    return route.fallback()
  })
  await page.route('**/api/stream/**/multivariant.m3u8*', (route) =>
    route.fulfill({
      contentType: 'application/vnd.apple.mpegurl',
      body: multivariantStartingAt(startPositionSeconds),
    }),
  )
  await page.route('**/api/stream/**/stream.m3u8*', (route) =>
    route.fulfill({
      contentType: 'application/vnd.apple.mpegurl',
      body: segmentedLevelPlaylist(2820),
    }),
  )
  // hls.js asks for a media segment only once it holds the initialization segment.
  const initialization = fileURLToPath(
    new URL('fixtures/initialization-segment.mp4', import.meta.url),
  )
  await page.route('**/api/stream/**/init.mp4*', (route) =>
    route.fulfill({ contentType: 'video/mp4', path: initialization }),
  )
  const segments: string[] = []
  page.on('request', (call) => {
    const name = new URL(call.url()).pathname.split('/').at(-1) ?? ''
    if (name.endsWith('.m4s')) segments.push(name)
  })

  await page.goto('/play/file-1?episode=e1&position=603')

  await expect.poll(() => segments).not.toHaveLength(0)
  // hls.js would ask for any other segment at once.
  await page.waitForTimeout(1000) // NOSONAR: proving an absence needs a bounded settle, not a condition
  expect(segments[0]).toBe('segment100.m4s')
  expect(segments).not.toContain('segment0.m4s')
  expect(startPositionSeconds).toBe(603)
})

test('the player keeps a Pause the viewer pressed before the stream loaded', async ({
  page,
  request,
}) => {
  let answerSegments: () => void = () => undefined
  const segmentsAnswered = new Promise<void>((resolve) => (answerSegments = resolve))
  await routePlayer(page, request, { operations: { MovieDetail: MOVIE_DETAIL } })
  await serveTheFirstMediaSegment(page, segmentsAnswered)
  const metadata = await watchForLoadedMetadata(page)
  await page.goto('/movie/m1')
  await page.getByRole('link', { name: 'Play' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await page.getByRole('button', { name: 'Pause' }).click()

  answerSegments()
  await metadata.loaded

  const video = page.locator('video')
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
})

test('the player opened from its address waits on Play when the browser refuses to start it', async ({
  page,
  request,
}) => {
  await routePlayer(page, request)
  await serveTheFirstMediaSegment(page)
  const metadata = await watchForLoadedMetadata(page)

  await page.goto('/play/file-1')
  await metadata.loaded

  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const video = page.locator('video')
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  expect(await video.evaluate((element: HTMLVideoElement) => element.muted)).toBe(false)
})

const DESTROYED_PLAYBACK_SESSIONS = `${STUB_URL}/__test/destroyed-playback-sessions`

// Playwright does not report the keepalive request a page sends while it unloads, so the stub API
// answers DestroyPlaybackSession itself and lists the sessions it destroyed.
async function openPlayerThatDestroysThroughTheStub(page: Page, request: APIRequestContext) {
  await request.delete(DESTROYED_PLAYBACK_SESSIONS)
  await openPlayer(page, request, { operations: { DestroyPlaybackSession: undefined } })
}

async function destroyedPlaybackSessions(request: APIRequestContext): Promise<string[]> {
  const response = await request.get(DESTROYED_PLAYBACK_SESSIONS)
  const body = (await response.json()) as { destroyedPlaybackSessions: string[] }
  return body.destroyedPlaybackSessions
}

// The browser unloads the page without unmounting its React tree, so only the page lifecycle can
// end the session, and the request that ends it has to outlive the page.
test('leaving the player for another page closes its playback session', async ({
  page,
  request,
}) => {
  await openPlayerThatDestroysThroughTheStub(page, request)

  await page.goto('about:blank')

  await expect.poll(() => destroyedPlaybackSessions(request)).toEqual(['playback-1'])
})

test('closing the tab closes its playback session', async ({ page, request }) => {
  await openPlayerThatDestroysThroughTheStub(page, request)

  await page.close()

  await expect.poll(() => destroyedPlaybackSessions(request)).toEqual(['playback-1'])
})

test('Space pauses and resumes a playing video', async ({ page, request }) => {
  await openPlayerFromThePlayLink(page, request)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

  await page.keyboard.press('Space')
  expect(await videoPaused(page)).toBe(true)
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()

  await page.keyboard.press('Space')
  expect(await videoPaused(page)).toBe(false)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})

test('after Tab to Mute, Space mutes and playback continues', async ({ page, request }) => {
  await openPlayerFromThePlayLink(page, request)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await tabThrough(page, [
    page.getByRole('button', { name: 'Back', exact: true }),
    page.getByRole('slider', { name: 'Seek' }),
    page.getByRole('button', { name: 'Mute' }),
  ])

  await page.keyboard.press('Space')

  await expect(page.getByRole('button', { name: 'Unmute' })).toBeFocused()
  expect(await videoPaused(page)).toBe(false)
})

test('Space pauses the video after Tab to the Audio chip, which opens nothing', async ({
  page,
  request,
}) => {
  await openPlayerFromThePlayLink(page, request)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await tabThrough(page, [
    page.getByRole('button', { name: 'Back', exact: true }),
    page.getByRole('slider', { name: 'Seek' }),
    page.getByRole('button', { name: 'Mute' }),
    page.getByRole('slider', { name: 'Volume' }),
    page.getByRole('button', { name: 'Back 10 seconds' }),
    page.getByRole('button', { name: 'Pause' }),
    page.getByRole('button', { name: 'Forward 10 seconds' }),
    page.getByRole('button', { name: /^Quality/ }),
    page.getByRole('button', { name: 'Audio: Audio' }),
  ])

  await page.keyboard.press('Space')

  expect(await videoPaused(page)).toBe(true)
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
})

test('after a click on Forward 10 seconds, a held Space pauses and skips no further', async ({
  page,
  request,
}) => {
  await openPlayerFromThePlayLink(page, request)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  const video = page.locator('video')
  await page.getByRole('button', { name: 'Forward 10 seconds' }).click()
  const skippedTo = await video.evaluate((element: HTMLVideoElement) => element.currentTime)
  expect(skippedTo).toBeGreaterThanOrEqual(10)

  // Playwright marks the second keydown as a repeat, because the key is already down.
  await page.keyboard.down('Space')
  await page.keyboard.down('Space')
  await page.keyboard.up('Space')

  const playhead = await video.evaluate((element: HTMLVideoElement) => element.currentTime)
  expect(playhead).toBeCloseTo(skippedTo, 0)
  expect(await videoPaused(page)).toBe(true)
})

test('a clicked Forward 10 seconds shows no focus ring while Space plays and pauses, and shows one after Tab and Shift+Tab', async ({
  page,
  request,
}) => {
  await openPlayerFromThePlayLink(page, request)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  const forward = page.getByRole('button', { name: 'Forward 10 seconds' })
  await forward.click()
  await page.keyboard.press('Space')
  expect(await videoPaused(page)).toBe(true)

  await page.keyboard.press('Space')

  expect(await videoPaused(page)).toBe(false)
  await expect(forward).toBeFocused()
  expect(await ringOnActiveElement(page)).not.toMatchObject(RING)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: /^Quality/ })).toBeFocused()
  expect(await ringOnActiveElement(page)).toMatchObject(RING)
  await page.keyboard.press('Shift+Tab')
  await expect(forward).toBeFocused()
  expect(await ringOnActiveElement(page)).toMatchObject(RING)
})

test('a clicked Audio chip, which opens nothing, shows no focus ring while Space plays and pauses', async ({
  page,
  request,
}) => {
  await openPlayerFromThePlayLink(page, request)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  const audio = page.getByRole('button', { name: 'Audio: Audio' })
  await clickAriaDisabled(page, audio)

  await page.keyboard.press('Space')

  expect(await videoPaused(page)).toBe(true)
  await expect(audio).toBeFocused()
  expect(await ringOnActiveElement(page)).not.toMatchObject(RING)
})

test('the Quality menu lists the choices the server offers and starts the picked one afresh', async ({
  page,
  request,
}) => {
  await openPlayer(page, request)
  const calls: string[] = []
  page.on('request', (call) => {
    if (call.url().endsWith('/graphql')) calls.push(operationName(call))
  })

  await page.getByRole('button', { name: 'Quality: Auto' }).click()
  const quality = page.getByRole('menu', { name: 'Quality' })
  await expect(quality.getByRole('menuitemradio')).toHaveText([
    'Original',
    'Auto',
    '720p',
    '480p',
    '360p',
  ])
  await expect(quality.getByRole('menuitemradio', { checked: true })).toHaveText('Auto')
  const created = page.waitForRequest((call) => operationName(call) === 'CreatePlaybackSession')
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')

  const input = ((await created).postDataJSON() as { variables: { input: unknown } }).variables
    .input
  expect(input).toMatchObject({ mediaFileId: 'file-1', options: { quality: 'ORIGINAL' } })
  expect(calls.filter((name) => name.endsWith('PlaybackSession'))).toEqual([
    'DestroyPlaybackSession',
    'CreatePlaybackSession',
  ])
})

// Routes added later take precedence, so the first media segment's route follows the player's.
async function openPlayerShowingMedia(page: Page, request: APIRequestContext): Promise<void> {
  await routePlayer(page, request)
  await serveTheFirstMediaSegment(page)
  await page.goto(PLAYER_PATH)
  await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-disabled', 'false')
}

// Picking Original answers a playback session whose first attempt is an encode, so Original
// changes to Auto: once the new stream shows its first frame, the notice shows and the Quality
// menu marks Original.
async function startOriginalWithAnEncode(page: Page): Promise<void> {
  await page.route('**/graphql', async (route) => {
    const body = route.request().postDataJSON() as {
      operationName?: string
      variables?: { input?: { options?: { quality?: string } } }
    } | null
    if (
      body?.operationName !== 'CreatePlaybackSession' ||
      body.variables?.input?.options?.quality !== 'ORIGINAL'
    ) {
      return route.fallback()
    }
    const created = PLAYER_OPERATIONS.CreatePlaybackSession as {
      createPlaybackSession: { playbackSession: object }
    }
    return route.fulfill({
      json: {
        data: {
          createPlaybackSession: {
            ...created.createPlaybackSession,
            playbackSession: {
              ...created.createPlaybackSession.playbackSession,
              id: 'playback-2',
              requestedChoice: 'ORIGINAL',
              playbackChoice: 'AUTO',
              formatChange: 'STARTED_WITH_ENCODE',
            },
          },
        },
      },
    })
  })
  await page.getByRole('button', { name: 'Quality: Auto' }).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toContainText('Quality is now set to Auto.')
}

const ORIGINAL_EXPLANATION =
  "This video couldn't play in its original form, so Quality changed to Auto."

test('the notice sits under Back, and the mark explains itself beside the menu, level with its row', async ({
  page,
  request,
}) => {
  await openPlayerShowingMedia(page, request)
  await startOriginalWithAnEncode(page)
  const back = (await page.getByRole('button', { name: 'Back', exact: true }).boundingBox()) as Box
  const notice = (await page
    .getByRole('status')
    .getByText(/converted/)
    .boundingBox()) as Box
  expect(notice.x).toBeCloseTo(back.x, 0)
  expect(notice.y).toBeGreaterThan(back.y + back.height)

  await page.getByRole('button', { name: 'Quality: Auto' }).click()
  await page.keyboard.press('ArrowUp')

  const menu = (await page.getByRole('menu', { name: 'Quality' }).boundingBox()) as Box
  const row = (await page
    .getByRole('menuitemradio', { name: `Original. ${ORIGINAL_EXPLANATION}` })
    .boundingBox()) as Box
  const explanation = (await page.getByText(ORIGINAL_EXPLANATION).boundingBox()) as Box
  expect(explanation.x + explanation.width).toBeLessThan(menu.x)
  expect(explanation.y).toBeCloseTo(row.y, 0)
})

test('on a phone the notice spans the player, and the explanation sits above the menu', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await openPlayerShowingMedia(page, request)
  await startOriginalWithAnEncode(page)
  const notice = (await page
    .getByRole('status')
    .getByText(/converted/)
    .boundingBox()) as Box
  expect(notice.x).toBeCloseTo(16, 0)
  expect(notice.width).toBeCloseTo(375 - 2 * 16, 0)

  await page.getByRole('button', { name: 'Quality: Auto' }).click()
  await page.keyboard.press('ArrowUp')

  const menu = (await page.getByRole('menu', { name: 'Quality' }).boundingBox()) as Box
  const explanation = (await page.getByText(ORIGINAL_EXPLANATION).boundingBox()) as Box
  expect(explanation.y + explanation.height).toBeLessThan(menu.y)
  expect(explanation.x).toBeGreaterThanOrEqual(0)
  expect(explanation.x + explanation.width).toBeLessThanOrEqual(375)
})

test('the explanation moves above the menu when the player narrows while it shows', async ({
  page,
  request,
}) => {
  await openPlayerShowingMedia(page, request)
  await startOriginalWithAnEncode(page)
  await page.getByRole('button', { name: 'Quality: Auto' }).click()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByText(ORIGINAL_EXPLANATION)).toBeVisible()

  await page.setViewportSize({ width: 375, height: 667 })

  const menu = (await page.getByRole('menu', { name: 'Quality' }).boundingBox()) as Box
  const explanation = (await page.getByText(ORIGINAL_EXPLANATION).boundingBox()) as Box
  expect(explanation.y + explanation.height).toBeLessThan(menu.y)
  expect(explanation.x).toBeGreaterThanOrEqual(0)
})

test('on a small phone held sideways the explanation above the menu stays on screen', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 568, height: 320 })
  await openPlayerShowingMedia(page, request)
  await startOriginalWithAnEncode(page)
  await page.getByRole('button', { name: 'Quality: Auto' }).click()

  await page.keyboard.press('ArrowUp')

  const menu = (await page.getByRole('menu', { name: 'Quality' }).boundingBox()) as Box
  const explanation = (await page.getByText(ORIGINAL_EXPLANATION).boundingBox()) as Box
  expect(explanation.y).toBeGreaterThanOrEqual(0)
  expect(explanation.y + explanation.height).toBeLessThan(menu.y)
  await expect(page.getByRole('menuitemradio', { name: /^Original/ })).toBeInViewport()
})

test('on a small phone held sideways hovering the marked row keeps the menu still', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 568, height: 320 })
  await openPlayerShowingMedia(page, request)
  await startOriginalWithAnEncode(page)
  await page.getByRole('button', { name: 'Quality: Auto' }).click()
  const original = page.getByRole('menuitemradio', { name: /^Original/ })

  await original.hover()
  await expect(page.getByText(ORIGINAL_EXPLANATION)).toBeVisible()

  // A row that moved from under the pointer would end its hover and move back, frame after frame.
  const rowTops = await original.evaluate(
    (row) =>
      new Promise<number[]>((resolve) => {
        const tops: number[] = []
        const sample = () => {
          tops.push(row.getBoundingClientRect().top)
          if (tops.length < 30) requestAnimationFrame(sample)
          else resolve(tops)
        }
        requestAnimationFrame(sample)
      }),
  )
  expect(new Set(rowTops).size).toBe(1)
  await expect(page.getByText(ORIGINAL_EXPLANATION)).toBeVisible()
})

test('a refusal keeps Retry above the control bar on a phone held sideways', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 667, height: 375 })
  await routePlayer(page, request, { operations: { CreatePlaybackSession: CAPACITY_REFUSAL } })
  await page.goto(PLAYER_PATH)
  const retry = page.getByRole('button', { name: 'Retry playback' })
  await expect(retry).toBeVisible()

  const retried = page.waitForRequest((call) => operationName(call) === 'CreatePlaybackSession')
  await retry.click()
  await retried
})

test('Mute holds its place when the stream declares its length', async ({ page, request }) => {
  let answerLevelPlaylist: () => void = () => undefined
  const levelPlaylistAnswered = new Promise<void>((resolve) => (answerLevelPlaylist = resolve))
  await routePlayer(page, request, { levelPlaylistAnswered })
  await page.goto(PLAYER_PATH)
  const mute = page.getByRole('button', { name: 'Mute' })
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled()
  await expect(page.getByRole('heading', { level: 1, name: 'Northern Line' })).toBeVisible()
  const unknownLength = await mute.boundingBox()

  answerLevelPlaylist()

  await expect(page.getByText('0:00 / 47:04')).toBeVisible()
  const knownLength = await mute.boundingBox()
  expect(knownLength?.x).toBeCloseTo(unknownLength?.x ?? Number.NaN, 0)
})

// Mantine paints the track on its ::before, which reaches past the track element on both sides.
async function seekTrackWithinCorners(page: Page) {
  return sliderTrack(page, 'Seek').evaluate((container) => {
    const track = container.firstElementChild
    const bar = container.parentElement?.parentElement
    if (!track || !bar) {
      throw new Error('the seek track sits outside the control bar')
    }
    const box = track.getBoundingClientRect()
    const painted = getComputedStyle(track, '::before')
    const outline = bar.getBoundingClientRect()
    const corner = Number.parseFloat(getComputedStyle(bar).borderTopLeftRadius)
    return {
      left: box.left + Number.parseFloat(painted.left) - (outline.left + corner),
      right: outline.right - corner - (box.right - Number.parseFloat(painted.right)),
    }
  })
}

for (const viewport of [
  { width: 1512, height: 850 },
  { width: 375, height: 667 },
]) {
  test(`the seek track ends inside the control bar's rounded corners ${viewport.width} wide`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport)
    await openPlayer(page, request)

    const inset = await seekTrackWithinCorners(page)
    expect(inset.left).toBeGreaterThanOrEqual(0)
    expect(inset.right).toBeGreaterThanOrEqual(0)
  })
}

const LAYOUTS = [
  { device: 'a phone', viewport: { width: 375, height: 667 }, volumeShown: false, oneRow: false },
  {
    device: 'a phone held sideways',
    viewport: { width: 667, height: 375 },
    volumeShown: false,
    oneRow: true,
  },
  { device: 'a tablet', viewport: { width: 820, height: 1180 }, volumeShown: false, oneRow: true },
  {
    device: 'a small laptop',
    viewport: { width: 1024, height: 768 },
    volumeShown: true,
    oneRow: true,
  },
]

for (const { device, viewport, volumeShown, oneRow } of LAYOUTS) {
  test(`the control bar keeps its controls apart on ${device}`, async ({ page, request }) => {
    await page.setViewportSize(viewport)
    await openPlayer(page, request)
    const volume = page.getByRole('slider', { name: 'Volume' })

    await expect(volume).toBeVisible({ visible: volumeShown })
    await expectControlsApart(
      page,
      volumeShown ? [...barControls(page), volume] : barControls(page),
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    const rowCentres = await Promise.all(
      [
        page.getByRole('button', { name: 'Mute' }),
        page.getByRole('button', { name: 'Play' }),
        page.getByRole('button', { name: 'Full screen' }),
      ].map(centreY),
    )
    expect(Math.max(...rowCentres) - Math.min(...rowCentres) < 8, 'one row').toBe(oneRow)
  })
}

for (const viewport of [
  { width: 568, height: 320 },
  { width: 640, height: 360 },
]) {
  test(`an hours-long timecode stays clear of Mute on a phone ${viewport.width} wide held sideways`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport)
    await openPlayer(page, request, { durationSeconds: 7471 })
    const timecode = page.getByText('0:00:00 / 2:04:31')
    await expect(timecode).toBeAttached()

    const mute = (await page.getByRole('button', { name: 'Mute' }).boundingBox()) as Box
    for (const text of [page.getByRole('heading', { level: 1 }), timecode]) {
      expect(overlap(await paintedBox(text), mute), `${String(text)} runs under Mute`).toBe(false)
    }
  })
}

test('the chips keep their values on a phone held upright', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 667 })

  await openPlayer(page, request)

  for (const [chip, value] of [
    ['Quality: Auto', 'Auto'],
    ['Audio: Audio', 'Audio'],
    ['Subtitles: Off', 'Off'],
  ]) {
    await expect(
      page.getByRole('button', { name: chip }).getByText(value, { exact: true }),
    ).toBeVisible()
  }
})

test('the pickers switch the audio and subtitles the stream declares', async ({
  page,
  request,
}) => {
  await openPlayer(page, request, { multivariant: MULTIVARIANT_WITH_TRACKS })

  await page.getByRole('button', { name: 'Audio: English' }).click()
  const audio = page.getByRole('menu', { name: 'Audio' })
  await expect(audio.getByRole('menuitemradio')).toHaveText(['English', 'Français', 'German'])
  const frenchRequested = page.waitForRequest(/\/audio-fr\.m3u8/)
  await audio.getByRole('menuitemradio', { name: 'Français' }).click()
  await frenchRequested
  await expect(page.getByRole('button', { name: 'Audio: Français' })).toBeFocused()

  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  const subtitles = page.getByRole('menu', { name: 'Subtitles' })
  await expect(subtitles.getByRole('menuitemradio', { checked: true })).toHaveText('Off')
  await page.keyboard.press('Shift+Tab')
  await expect(subtitles).toBeHidden()
  await expect(page.getByRole('button', { name: 'Subtitles: Off' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  expect(await ringOnActiveElement(page)).toMatchObject({ name: 'English (SDH)', ...RING })
  const englishRequested = page.waitForRequest(/\/subtitles-en\.m3u8/)
  await page.keyboard.press('Enter')
  await englishRequested
  const subtitlesChip = page.getByRole('button', { name: 'Subtitles: English (SDH)' })
  await expect(subtitlesChip).toBeFocused()
  await expect(subtitlesChip.getByTestId('active-track')).toBeVisible()
})

test('Space chooses the picker row that has focus and shows its ring, after a click on the chip or an arrow key', async ({
  page,
  request,
}) => {
  await openPlayer(page, request, { multivariant: MULTIVARIANT_WITH_TRACKS })
  const chip = page.getByRole('button', { name: /^Audio/ })
  const audio = page.getByRole('menu', { name: 'Audio' })

  await chip.click()
  await expect(audio.getByRole('menuitemradio', { name: 'English' })).toBeFocused()
  await page.keyboard.down('Space')
  expect(await ringOnActiveElement(page)).toMatchObject({ name: 'English', ...RING })
  await page.keyboard.up('Space')
  await expect(audio).toBeHidden()
  await expect(page.getByRole('button', { name: 'Audio: English' })).toBeFocused()
  expect(await videoPaused(page)).toBe(true)

  await chip.click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Audio: Français' })).toBeFocused()
  expect(await videoPaused(page)).toBe(true)
})

test('Space plays the video, and opens no menu, on an Audio chip clicked before its choices arrived', async ({
  page,
  request,
}) => {
  await routePlayer(page, request)
  let answerMultivariant: () => void = () => undefined
  const multivariantAnswered = new Promise<void>((resolve) => (answerMultivariant = resolve))
  await page.route('**/api/stream/**/multivariant.m3u8*', async (route) => {
    await multivariantAnswered
    return route.fulfill({
      contentType: 'application/vnd.apple.mpegurl',
      body: MULTIVARIANT_WITH_TRACKS,
    })
  })
  await page.goto('/play/file-1')
  const chip = page.getByRole('button', { name: /^Audio/ })
  await expect(chip).toHaveAttribute('aria-disabled', 'true')
  await clickAriaDisabled(page, chip)
  answerMultivariant()
  await expect(page.getByRole('button', { name: 'Audio: English' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled()

  await page.keyboard.press('Space')

  await expect(page.getByRole('menu', { name: 'Audio' })).toBeHidden()
  expect(await videoPaused(page)).toBe(false)
  expect(await ringOnActiveElement(page)).not.toMatchObject(RING)
})

for (const viewport of [
  { width: 1512, height: 850 },
  { width: 667, height: 375 },
]) {
  test(`an open picker points at its chip from above the bar at ${viewport.width} wide`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport)
    await openPlayer(page, request, { multivariant: MULTIVARIANT_WITH_TRACKS })
    const chip = page.getByRole('button', { name: 'Subtitles: Off' })

    await chip.click()

    const popover = await popoverPlacement(page.getByRole('menu', { name: 'Subtitles' }))
    const chipBox = (await chip.boundingBox()) as Box
    const seekBox = (await page.getByRole('slider', { name: 'Seek' }).boundingBox()) as Box
    expect(popover.left).toBeGreaterThanOrEqual(0)
    expect(popover.right).toBeLessThanOrEqual(viewport.width)
    expect(popover.top).toBeGreaterThanOrEqual(0)
    expect(popover.bottom).toBeLessThan(seekBox.y)
    expect(popover.caretX).toBeCloseTo(chipBox.x + chipBox.width / 2, 0)
  })
}

const H264_HD = {
  __typename: 'VideoFormat',
  codec: 'h264',
  width: 1280,
  height: 720,
  frameRate: 25,
  bitrate: 1_800_000,
  videoRange: 'SDR',
  dolbyVision: false,
}

// The server encodes the HEVC source because the browser declares no HEVC, and copies its audio.
const ENCODE_DECISION = {
  PlaybackDecisions: {
    playbackSession: {
      __typename: 'PlaybackSession',
      id: 'playback-1',
      decisions: [
        {
          __typename: 'PlaybackDecision',
          formatAttempt: 1,
          streamSessionId: 'sess-1',
          video: {
            __typename: 'VideoDelivery',
            delivery: 'ENCODE',
            source: { ...H264_HD, codec: 'hevc', bitrate: 6_000_000 },
            output: H264_HD,
          },
          audio: {
            __typename: 'AudioDelivery',
            delivery: 'COPY',
            source: { __typename: 'AudioFormat', codec: 'aac', channels: 2, bitrate: 128_000 },
            output: { __typename: 'AudioFormat', codec: 'aac', channels: 2, bitrate: 128_000 },
          },
          reasons: ['VIDEO_CODEC_NOT_DECLARED'],
        },
      ],
    },
  },
}

async function openPlaybackData(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('menuitemradio', { name: 'Playback data' }).click()
  return page.getByRole('region', { name: 'Playback data' })
}

function factIn(panel: Locator, group: string, name: string): Locator {
  return panel
    .getByRole('region', { name: group })
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .locator('xpath=following-sibling::dd')
}

function trackIn(panel: Locator, name: string): Locator {
  return panel.getByRole('region', { name: 'Server' }).getByRole('region', { name })
}

test('playback data shows what hls.js reports of the playing variant and why the server encodes', async ({
  page,
  request,
}) => {
  await routePlayer(page, request, {
    operations: { MovieDetail: MOVIE_DETAIL, ...ENCODE_DECISION },
  })
  await serveTheFirstMediaSegment(page)
  await page.goto('/movie/m1')
  await page.getByRole('link', { name: 'Play' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()

  const panel = await openPlaybackData(page)

  await expect(factIn(panel, 'Player', 'Quality step')).toHaveText('720p · 2 Mb/s (1 of 1)')
  await expect(factIn(panel, 'Player', 'Resolution')).toHaveText('1280×720')
  await expect(factIn(panel, 'Player', 'Video codec')).toHaveText('avc1.64001f')
  await expect(factIn(panel, 'Player', 'Audio')).toHaveText('mp4a.40.2 · Stereo')
  await expect(factIn(panel, 'Player', 'HDR mode')).toHaveText('SDR')
  await expect(factIn(panel, 'This screen', 'Display')).toHaveText(/^\d+×\d+ at [\d.]+×$/)
  await expect(factIn(panel, 'This screen', 'Browser')).toHaveText(/^Chrome \d+$/)
  const video = trackIn(panel, 'Video')
  await expect(video.getByRole('heading')).toHaveText('Video Encode')
  await expect(video.getByRole('row', { name: /^Codec \(changed\)/ })).toHaveText(/HEVC\s*H\.264/)
  await expect(video.getByRole('list', { name: 'Video reasons' })).toHaveText(
    "This device can't play the video's codec (HEVC).",
  )

  await panel.getByRole('button', { name: 'Close playback data' }).click()

  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})

for (const viewport of [
  { name: 'a phone held upright', width: 375, height: 667 },
  { name: 'a tablet held upright', width: 768, height: 1024 },
  { name: 'a small laptop window', width: 800, height: 600 },
  { name: 'a laptop', width: 1280, height: 800 },
]) {
  test(`on ${viewport.name} playback data stays on screen and leaves Back clickable`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await openPlayer(page, request, { operations: ENCODE_DECISION })

    const panel = await openPlaybackData(page)

    await expect(trackIn(panel, 'Video').getByRole('heading')).toHaveText('Video Encode')
    const back = page.getByRole('button', { name: 'Back', exact: true })
    const panelBox = await panel.boundingBox()
    const backBox = await back.boundingBox()
    expect(panelBox && backBox).not.toBeNull()
    expect(panelBox!.x).toBeGreaterThanOrEqual(16)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width - 16)
    const besideBack = panelBox!.x >= backBox!.x + backBox!.width
    const belowBack = panelBox!.y >= backBox!.y + backBox!.height
    expect(besideBack || belowBack).toBe(true)
    await back.click({ trial: true })
  })
}
