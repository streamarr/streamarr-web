import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { MovieDetailQuery } from '../src/graphql/generated/graphql'
import { STUB_URL } from './ports'

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })

const movie: MovieDetailQuery & { movie: { __typename: 'Movie' } } = {
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
    cast: [
      { id: 'p1', name: 'Lead Actor', images: [] },
      { id: 'p2', name: 'Supporting Actor', images: [] },
    ],
    ratings: [],
    files: [{ id: 'file-1' }],
    watchStatus: 'UNWATCHED',
    watchProgress: null,
    backdropImages: [],
    posterImages: [],
  },
}

// Fragment spreads on Image only match in the cache when the object carries its __typename.
const AMBER_BACKDROP = {
  __typename: 'Image',
  aspectRatio: 1.78,
  blurHash: null,
  ambientColors: {
    topLeft: '#e9b658',
    topRight: '#e9b658',
    bottomRight: '#e9b658',
    bottomLeft: '#e9b658',
    primary: '#e9b658',
    theme: {
      base: '#e9b658',
      panel: '#f0c069',
      selected: '#f0c069',
      accent: '#2a1806',
      onAccent: '#ffd9a0',
      textPrimary: '#241505',
      textSecondary: '#5b4326',
    },
  },
  variants: [],
}

async function openMovie(
  page: Page,
  request: APIRequestContext,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName?: string }
    if (operationName !== 'MovieDetail') return route.continue()
    return route.fulfill({ json: { data: { movie: { ...movie.movie, ...overrides } } } })
  })
  await page.goto('/movie/m1')
  await expect(page.getByRole('heading', { level: 1, name: 'Everlight' })).toBeVisible()
}

test('the detail page is ambient edge to edge with the signed-in chrome on it', async ({
  page,
  request,
}) => {
  await openMovie(page, request)

  const nav = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
  const hero = await page.getByTestId('backdrop-hero').boundingBox()
  expect(nav!.y).toBeLessThan(hero!.y)
  expect(hero).toEqual(expect.objectContaining({ x: 0, width: 1440 }))
  expect(await page.locator('[class*="homeShell"]').count()).toBe(0)
})

test('the signed-in chrome takes the artwork text color on a bright theme', async ({
  page,
  request,
}) => {
  await openMovie(page, request, { backdropImages: [AMBER_BACKDROP] })

  const ink = 'rgb(36, 21, 5)'
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveCSS('color', ink)
  await expect(page.getByRole('img', { name: 'Streamarr' })).toHaveCSS('color', ink)
  await expect(page.getByRole('button', { name: /^Profile menu/ })).toHaveCSS('color', ink)
})

test('the title column keeps its width on a phone when there are no ratings', async ({
  page,
  request,
}) => {
  await openMovie(page, request)
  await page.setViewportSize({ width: 375, height: 667 })

  const title = await page.getByRole('heading', { level: 1, name: 'Everlight' }).boundingBox()
  expect(title!.width).toBeGreaterThan(200)
})

test('the ratings stack under the title on a phone', async ({ page, request }) => {
  await openMovie(page, request, { ratings: [{ id: 'r1', source: 'TMDB', value: '7.8' }] })
  await page.setViewportSize({ width: 375, height: 667 })

  const title = await page.getByRole('heading', { level: 1, name: 'Everlight' }).boundingBox()
  const chip = await page.getByText('TMDB · 7.8').boundingBox()
  expect(title!.width).toBeGreaterThan(200)
  expect(chip!.y).toBeGreaterThan(title!.y + title!.height)
})

test('the metadata columns clear the Back button on a phone', async ({ page, request }) => {
  await openMovie(page, request, {
    genres: [
      { id: 'g1', name: 'Fantasy' },
      { id: 'g2', name: 'Adventure' },
      { id: 'g3', name: 'Comedy' },
    ],
    directors: [{ id: 'p3', name: 'Terry Gilliam' }],
    contentRating: { value: 'PG' },
  })
  await page.setViewportSize({ width: 375, height: 667 })

  const back = await page.getByRole('button', { name: 'Back' }).boundingBox()
  const metadata = await page.locator('dl', { hasText: 'Genre' }).boundingBox()
  expect(intersects(back!, metadata!)).toBe(false)
})

type Box = { x: number; y: number; width: number; height: number }

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

test('cast artwork stays portrait-shaped in the shared shelf on desktop and a phone', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName?: string }
    if (operationName !== 'MovieDetail') return route.continue()
    return route.fulfill({ json: { data: movie } })
  })
  await page.goto('/movie/m1')
  await expect(page.getByRole('heading', { level: 1, name: 'Everlight' })).toBeVisible()

  const shelf = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Cast', exact: true }) })
  const portrait = shelf
    .getByText('Lead Actor', { exact: true })
    .locator('..')
    .locator('[class*="_portrait_"]')
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(viewport)
    const bounds = await portrait.boundingBox()
    expect(bounds!.width).toBeGreaterThan(0)
    expect(bounds!.width).toBeLessThan(bounds!.height)
  }
})
