import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
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

async function openPlayer(page: Page, request: APIRequestContext): Promise<void> {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName?: string }
    const data = PLAYER_OPERATIONS[operationName ?? '']
    return data ? route.fulfill({ json: { data } }) : route.continue()
  })
  await page.route('**/api/stream/**/multivariant.m3u8*', (route) =>
    route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: MULTIVARIANT }),
  )
  await page.route('**/api/stream/**/stream.m3u8*', (route) =>
    route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: LEVEL }),
  )
  await page.route(/\/api\/stream\/.*\.(mp4|m4s)/, () => new Promise(() => undefined))
  await page.goto('/play/file-1')
  await expect(page.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-disabled', 'false')
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

const LAYOUTS = [
  { device: 'a phone', viewport: { width: 375, height: 667 }, volumeShown: false },
  { device: 'a tablet', viewport: { width: 820, height: 1180 }, volumeShown: false },
  { device: 'a small laptop', viewport: { width: 1024, height: 768 }, volumeShown: true },
]

for (const { device, viewport, volumeShown } of LAYOUTS) {
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
  })
}
