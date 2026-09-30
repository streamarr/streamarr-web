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
import { RING, ringOnActiveElement } from './focusRing'
import { STUB_URL } from './ports'

// The session's stream is 47:04 long, and its media never arrives: the playlists answer and every
// segment request hangs. Each spec ends well inside the player's 30-second startup deadline.
test.use({ viewport: { width: 1512, height: 850 }, serviceWorkers: 'block' })

const MULTIVARIANT = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
  'stream.m3u8?t=playback-token',
  '',
].join('\n')

const LEVEL = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-TARGETDURATION:2824',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXT-X-MAP:URI="init.mp4"',
  '#EXTINF:2824.0,',
  'segment0.m4s',
  '#EXT-X-ENDLIST',
  '',
].join('\n')

interface PlayerRoutes {
  operations?: Record<string, unknown>
  levelPlaylistAnswered?: Promise<void>
}

async function routePlayer(
  page: Page,
  request: APIRequestContext,
  { operations = {}, levelPlaylistAnswered = Promise.resolve() }: PlayerRoutes = {},
): Promise<void> {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const data = { ...PLAYER_OPERATIONS, ...operations }[operationName(route.request())]
    return data ? route.fulfill({ json: { data } }) : route.continue()
  })
  await page.route('**/api/stream/**/multivariant.m3u8*', (route) =>
    route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: MULTIVARIANT }),
  )
  await page.route('**/api/stream/**/stream.m3u8*', async (route) => {
    await levelPlaylistAnswered
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: LEVEL })
  })
  await page.route(/\/api\/stream\/.*\.(mp4|m4s)/, () => new Promise(() => undefined))
}

async function openPlayer(page: Page, request: APIRequestContext): Promise<void> {
  await routePlayer(page, request)
  await page.goto('/play/file-1')
  await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-disabled', 'false')
}

function operationName(call: Request): string {
  const body = call.postDataJSON() as { operationName?: string } | null
  return body?.operationName ?? ''
}

const PLAYER_OPERATIONS: Record<string, unknown> = {
  CreateStreamSession: {
    createStreamSession: {
      session: {
        id: 'sess-1',
        streamUrl: '/api/stream/e2e/multivariant.m3u8?t=playback-token',
        transcodeMode: 'REMUX',
      },
      userErrors: [],
    },
  },
  ReportStreamSessionTimeline: { reportStreamSessionTimeline: true },
  DestroyStreamSession: { destroyStreamSession: true },
}

const CAPACITY_REFUSAL = {
  createStreamSession: {
    session: null,
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
    watchStatus: 'UNWATCHED',
    watchProgress: null,
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
    return node.scrollWidth > node.clientWidth || ancestors.some(clippedBy)
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
    page.getByText('0:00 / 47:04'),
    page.getByRole('button', { name: 'Mute' }),
    page.getByRole('button', { name: 'Back 10 seconds' }),
    page.getByRole('button', { name: 'Play' }),
    page.getByRole('button', { name: 'Forward 10 seconds' }),
    page.getByRole('button', { name: 'Quality: Auto' }),
    page.getByRole('button', { name: 'Full screen' }),
  ]
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
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

test('Space pauses the video after Tab to the Quality chip, which opens nothing', async ({
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

test('a clicked Quality chip, which opens nothing, shows no focus ring while Space plays and pauses', async ({
  page,
  request,
}) => {
  await openPlayerFromThePlayLink(page, request)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  const quality = page.getByRole('button', { name: /^Quality/ })
  // Playwright refuses to click an aria-disabled button, but a mouse can still click and focus it.
  await quality.click({ force: true })

  await page.keyboard.press('Space')

  expect(await videoPaused(page)).toBe(true)
  await expect(quality).toBeFocused()
  expect(await ringOnActiveElement(page)).not.toMatchObject(RING)
})

test('a refusal keeps Retry above the control bar on a phone held sideways', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 667, height: 375 })
  await routePlayer(page, request, { operations: { CreateStreamSession: CAPACITY_REFUSAL } })
  await page.goto('/play/file-1')
  const retry = page.getByRole('button', { name: 'Retry playback' })
  await expect(retry).toBeVisible()

  const retried = page.waitForRequest((call) => operationName(call) === 'CreateStreamSession')
  await retry.click()
  await retried
})

test('Mute holds its place when the stream declares its length', async ({ page, request }) => {
  let answerLevelPlaylist: () => void = () => undefined
  const levelPlaylistAnswered = new Promise<void>((resolve) => (answerLevelPlaylist = resolve))
  await routePlayer(page, request, { levelPlaylistAnswered })
  await page.goto('/play/file-1')
  const mute = page.getByRole('button', { name: 'Mute' })
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled()
  const unknownLength = await mute.boundingBox()

  answerLevelPlaylist()

  await expect(page.getByText('0:00 / 47:04')).toBeVisible()
  const knownLength = await mute.boundingBox()
  expect(knownLength?.x).toBeCloseTo(unknownLength?.x ?? Number.NaN, 0)
})

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
        page.getByText('0:00 / 47:04'),
        page.getByRole('button', { name: 'Play' }),
        page.getByRole('button', { name: 'Full screen' }),
      ].map(centreY),
    )
    expect(Math.max(...rowCentres) - Math.min(...rowCentres) < 8, 'one row').toBe(oneRow)
  })
}
