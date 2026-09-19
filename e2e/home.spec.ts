import { expect, test } from '@playwright/test'
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
    watchProgress: { positionSeconds: 600, percentComplete: 25, durationSeconds: 2400 },
    files: [{ id: `home-file-${index}` }],
  }
}

const home: HomeQuery = {
  continueWatching: Array.from({ length: 6 }, (_, index) => movie(index)),
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
    const { operationName } = route.request().postDataJSON()
    if (operationName === 'Home') return route.fulfill({ json: { data: home } })
    if (operationName === 'Libraries')
      return route.fulfill({ json: { data: { libraries: home.libraries } } })
    return route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: FEATURED_TITLE })).toBeVisible()
})

test('continue-watching cards fit the shelf and grow with the available width', async ({
  page,
}) => {
  const shelf = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Continue watching' }) })
  const card = shelf.getByText(FEATURED_TITLE, { exact: true }).locator('..')
  const track = shelf.locator('[class*="_track_"]')
  const phoneWidth = await card.evaluate((element) => element.clientWidth)
  const shelfWidth = await track.evaluate((element) => element.clientWidth)
  expect(phoneWidth).toBeLessThanOrEqual(shelfWidth)
  expect(phoneWidth).toBeGreaterThan(shelfWidth * 0.65)

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect
    .poll(() => card.evaluate((element) => element.clientWidth))
    .toBeGreaterThan(phoneWidth)
  const art = await card.locator('[class*="_stillArt_"]').boundingBox()
  expect(art!.width / art!.height).toBeCloseTo(16 / 9, 2)
})

test('shelf cards keep a readable minimum on narrow screens without overflowing the shelf', async ({
  page,
}) => {
  const shelf = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Continue watching' }) })
  const card = shelf.getByText(FEATURED_TITLE, { exact: true }).locator('..')
  const track = shelf.locator('[class*="_track_"]')
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
  const hero = page.locator('[class*="_hero_"]')
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
  const body = firstSection.locator('[class*="_body_"]')
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
  const body = section.locator('[class*="_body_"]')
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
