import { watchingConnection } from '../src/test/continueWatchingFixtures'
import { expect, test, type Page } from '@playwright/test'
import type { HomeQuery } from '../src/graphql/generated/graphql'
import { STUB_URL } from './ports'

test.use({ viewport: { width: 375, height: 667 }, serviceWorkers: 'block' })

const FEATURED_TITLE = 'A Journey Beyond the Northern Lights'

function movie(index: number) {
  return {
    __typename: 'Movie' as const,
    id: `home-movie-${index}`,
    title: index === 0 ? FEATURED_TITLE : `Movie ${index}`,
    titleSort: `Movie ${index}`,
    tagline: 'An unexpected adventure.',
    summary:
      'A group of friends travels beyond familiar places and discovers a world full of surprises.',
    runtime: 142,
    releaseDate: '2024-01-01',
    createdOn: '2026-08-26T12:00:00Z',
    genres: [
      { id: 'drama', name: 'Drama' },
      { id: 'adventure', name: 'Adventure' },
    ],
    images: [],
    backdropImages: [],
    watchStatus: 'IN_PROGRESS' as const,
    lastWatchedAt: null,
    watchProgress: { positionSeconds: 600, percentComplete: 25, durationSeconds: 2400 },
    files: [{ id: `home-file-${index}` }],
  }
}

const home: HomeQuery = {
  continueWatching: watchingConnection([
    ...Array.from({ length: 5 }, (_, index) => movie(index)),
    { ...movie(5), files: [] },
  ]),
  libraries: ['Movies', 'Family movies', 'Documentaries'].map((name, libraryIndex) => ({
    __typename: 'Library',
    id: `home-library-${libraryIndex}`,
    name,
    type: 'MOVIE',
    items: {
      edges: Array.from({ length: 18 }, (_, index) => {
        const node = movie(10 + libraryIndex * 18 + index)
        return { cursor: node.id, node }
      }),
    },
  })),
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName?: string }
    if (operationName === 'Home') return route.fulfill({ json: { data: home } })
    if (operationName === 'Libraries')
      return route.fulfill({ json: { data: { libraries: home.libraries } } })
    return route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: FEATURED_TITLE })).toBeVisible()
})

const WHITE_BACKDROP = {
  aspectRatio: 1.78,
  blurHash: null,
  variants: [{ id: 'white', size: 'LARGE', width: 1920, height: 1080, url: '/white-backdrop.svg' }],
}

// The red channel of each screenshot pixel in the box, row by row; the hero's pixels are grey.
async function redChannel(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<number[][]> {
  const png = await page.screenshot({ clip })
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('no 2D canvas to read the screenshot')
    }
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    return Array.from({ length: image.height }, (_, row) =>
      Array.from({ length: image.width }, (_, column) => data[(row * image.width + column) * 4]),
    )
  }, png.toString('base64'))
}

test('the hero scrim darkens a bright backdrop out to the edge of its rounded corners', async ({
  page,
}) => {
  await page.route('**/white-backdrop.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="100%" height="100%" fill="#fff"/></svg>',
    }),
  )
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName?: string }
    if (operationName !== 'Home') return route.fallback()
    const featured = { ...movie(0), images: [WHITE_BACKDROP] }
    return route.fulfill({
      json: { data: { ...home, continueWatching: watchingConnection([featured]) } },
    })
  })
  await page.reload()

  const hero = (await page.getByTestId('billboard-hero').boundingBox())!
  const size = 24
  // No scrim reaches the top-right corner, so the backdrop shows there once it has faded in.
  const topRight = { x: hero.x + hero.width - size, y: hero.y + size, width: 1, height: 1 }
  await expect.poll(async () => (await redChannel(page, topRight))[0][0]).toBeGreaterThan(250)

  const corner = await redChannel(page, { x: hero.x, y: hero.y, width: size, height: size })
  const outside = corner[0][0]
  // The box's right-hand column lies inside the hero, past the curve, where the scrim is lightest.
  const inside = Math.max(...corner.map((row) => row[row.length - 1]))
  // An edge pixel blends the page behind the hero with the hero, so it can't outshine both.
  expect(Math.max(...corner.flat())).toBeLessThanOrEqual(Math.max(outside, inside) + 2)
})

test('the billboard tagline sits upright under the title', async ({ page }) => {
  const hero = page.getByTestId('billboard-hero')
  const tagline = hero.getByText('An unexpected adventure.', { exact: true })
  await expect(tagline).toHaveCSS('font-style', 'normal')
  const title = await hero.getByRole('heading', { level: 1, name: FEATURED_TITLE }).boundingBox()
  const taglineBox = await tagline.boundingBox()
  expect(taglineBox!.y).toBeGreaterThanOrEqual(title!.y + title!.height)
})

test('continue-watching cards fit the shelf and grow with the available width', async ({
  page,
}) => {
  const shelf = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Continue watching' }) })
  const card = shelf.getByText(FEATURED_TITLE, { exact: true }).locator('..')
  const track = shelf.getByTestId('shelf-track')
  const phoneWidth = await card.evaluate((element) => element.clientWidth)
  const shelfWidth = await track.evaluate((element) => element.clientWidth)
  expect(phoneWidth).toBeLessThanOrEqual(shelfWidth)
  expect(phoneWidth).toBeGreaterThan(shelfWidth * 0.65)
  const unavailableCard = shelf.getByText('Movie 5', { exact: true }).locator('..')
  expect(await unavailableCard.evaluate((element) => element.clientWidth)).toBe(phoneWidth)

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect
    .poll(() => card.evaluate((element) => element.clientWidth))
    .toBeGreaterThan(phoneWidth)
  expect(await unavailableCard.evaluate((element) => element.clientWidth)).toBe(
    await card.evaluate((element) => element.clientWidth),
  )
  const art = await card.getByTestId('still-art').boundingBox()
  expect(art!.width / art!.height).toBeCloseTo(16 / 9, 2)
})

test('shelf cards keep a readable minimum on narrow screens without overflowing the shelf', async ({
  page,
}) => {
  const shelf = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Continue watching' }) })
  const card = shelf.getByText(FEATURED_TITLE, { exact: true }).locator('..')
  const track = shelf.getByTestId('shelf-track')
  for (const width of [320, 280]) {
    await page.setViewportSize({ width, height: 568 })
    const rootFontSize = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).fontSize),
    )
    const availableWidth = await track.evaluate((element) => element.clientWidth)
    const cardWidth = await card.evaluate((element) => element.clientWidth)
    expect(cardWidth).toBeGreaterThanOrEqual(Math.min(16 * rootFontSize, availableWidth) - 1)
    expect(cardWidth).toBeLessThanOrEqual(availableWidth)
  }
})

test('shelf arrows have comfortable minimum target sizes', async ({ page }) => {
  for (const name of ['Scroll left', 'Scroll right']) {
    const bounds = await page.getByRole('button', { name, exact: true }).boundingBox()
    expect(bounds!.width).toBeGreaterThanOrEqual(44)
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
  }
})

test('the hero grows for its content and adapts to the viewport without clipping text', async ({
  page,
}, testInfo) => {
  const hero = page.getByTestId('billboard-hero')
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 812, height: 375 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    const layout = await hero.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const text = [...element.querySelectorAll('h1, p, a')]
      return text.map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          contained:
            rect.top >= bounds.top &&
            rect.bottom <= bounds.bottom &&
            rect.left >= bounds.left &&
            rect.right <= bounds.right,
          fitsWidth: node.scrollWidth <= node.clientWidth,
        }
      })
    })
    expect(layout.every((item) => item.contained && item.fitsWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}.png`) })
  }
  const initialHeight = await hero.evaluate((element) => element.clientHeight)
  await page.setViewportSize({ width: 1440, height: 1200 })
  await expect
    .poll(() => hero.evaluate((element) => element.clientHeight))
    .toBeGreaterThan(initialHeight)
})

test('recent libraries keep readable posters and size their scroll panels to the screen', async ({
  page,
}, testInfo) => {
  const sections = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /^Recently added in / }) })
  const firstSection = sections.first()
  const body = firstSection.getByTestId('section-body')
  const phoneBodyHeight = await body.evaluate((element) => element.clientHeight)
  expect(phoneBodyHeight).toBeLessThan(667 * 0.8)
  const firstPoster = firstSection.getByText('Movie 10', { exact: true }).locator('..')
  const posterWidth = await firstPoster.evaluate((element) => element.clientWidth)
  const sectionWidth = await firstSection.evaluate((element) => element.clientWidth)
  expect(posterWidth).toBeGreaterThan(375 * 0.25)
  expect(posterWidth).toBeLessThan(sectionWidth * 0.6)
  await firstSection.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('home-phone-recent.png') })

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect
    .poll(() => body.evaluate((element) => element.clientHeight))
    .toBeGreaterThan(phoneBodyHeight)
  const desktopSections = await sections.evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect()
      return { top: bounds.top, left: bounds.left }
    }),
  )
  expect(desktopSections[0].top).toBe(desktopSections[1].top)
  expect(desktopSections[1].left).toBeGreaterThan(desktopSections[0].left)
})

test('recent-content panels keep enough height for a poster on short screens', async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 320 })
  const section = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Recently added in Movies', exact: true }) })
  const body = section.getByTestId('section-body')
  const posterHeight = await section
    .getByText('Movie 10', { exact: true })
    .locator('..')
    .evaluate((element) => element.clientHeight)
  const visibleHeight = await body.evaluate((element) => {
    const style = getComputedStyle(element)
    return element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  })
  expect(visibleHeight).toBeGreaterThanOrEqual(posterHeight)
})

test('the shelf arrows scroll smoothly, and jump at once for a viewer who prefers reduced motion', async ({
  page,
}) => {
  const shelf = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Continue watching' }) })
  const scrollRight = shelf.getByRole('button', { name: 'Scroll right', exact: true })
  const offsetRightAfterClick = () =>
    scrollRight.evaluate((button: HTMLButtonElement) => {
      const track = button
        .closest('section')!
        .querySelector<HTMLElement>('[data-testid="shelf-track"]')!
      track.scrollTo({ left: 0, behavior: 'instant' })
      button.click()
      return track.scrollLeft
    })

  expect(await offsetRightAfterClick()).toBe(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await offsetRightAfterClick()).toBeGreaterThan(0)
})
