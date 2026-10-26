import { expect, test, type Page } from '@playwright/test'
import type { SeasonDetailQuery } from '../src/graphql/generated/graphql'
import { movie, openMovie } from './movieDetail'
import { STUB_URL } from './ports'

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })

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

test('the detail page is ambient edge to edge with the signed-in chrome on it', async ({
  page,
  request,
}) => {
  await openMovie(page, request)

  const nav = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
  const hero = await page.getByTestId('backdrop-hero').boundingBox()
  expect(nav!.y).toBeLessThan(hero!.y)
  expect(hero).toEqual(expect.objectContaining({ x: 0, width: 1440 }))
  await expect(page.getByTestId('home-shell')).toHaveCount(0)
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

test('the tagline sits upright under the title', async ({ page, request }) => {
  await openMovie(page, request, { tagline: 'Change begins with a whisper.' })

  const tagline = page.getByText('Change begins with a whisper.', { exact: true })
  await expect(tagline).toHaveCSS('font-style', 'normal')
  const title = await page.getByRole('heading', { level: 1, name: 'Everlight' }).boundingBox()
  const taglineBox = await tagline.boundingBox()
  expect(taglineBox!.y).toBeGreaterThanOrEqual(title!.y + title!.height)
})

test('the metadata columns clear the Back button on a phone', async ({ page, request }) => {
  await openMovie(page, request, {
    genres: [
      { id: 'g1', name: 'Fantasy' },
      { id: 'g2', name: 'Adventure' },
      { id: 'g3', name: 'Comedy' },
    ],
    directors: [
      { id: 'p3', name: 'Terry Gilliam' },
      { id: 'p4', name: 'Terry Jones' },
    ],
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
    .getByTestId('cast-portrait')
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

// Registered after openMovie, so it sees only the requests that follow the first load. Once a
// mark succeeds, the movie answers with the marked item's watch state, as the server would.
async function answerMarkWatched(
  page: Page,
  markWatched: { item: object | null; userErrors: object[] },
) {
  const later = { movieRequests: 0, marked: false }
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName?: string }
    if (operationName === 'MovieDetail') {
      later.movieRequests += 1
      if (!later.marked) return route.fallback()
      return route.fulfill({ json: { data: { movie: { ...movie.movie, ...markWatched.item } } } })
    }
    if (operationName !== 'MarkWatched') return route.fallback()
    later.marked = markWatched.item !== null
    return route.fulfill({ json: { data: { markWatched } } })
  })
  return later
}

test('marking the movie watched flips the verb from the returned movie and then reads it again', async ({
  page,
  request,
}) => {
  await openMovie(page, request)
  const later = await answerMarkWatched(page, {
    item: { __typename: 'Movie', id: 'm1', watchStatus: 'WATCHED', watchProgress: null },
    userErrors: [],
  })

  await page.getByRole('button', { name: 'Mark watched', exact: true }).click()

  await expect(page.getByRole('button', { name: 'Mark unwatched', exact: true })).toBeVisible()
  await expect.poll(() => later.movieRequests).toBe(1)
  await expect(page.getByRole('button', { name: 'Mark unwatched', exact: true })).toBeVisible()
})

test('a refused mark shows the server message and keeps the verb', async ({ page, request }) => {
  await openMovie(page, request)
  await answerMarkWatched(page, {
    item: null,
    userErrors: [
      {
        __typename: 'ItemNotFoundError',
        message: 'No movie, episode, season or series has the given ID.',
      },
    ],
  })

  await page.getByRole('button', { name: 'Mark watched', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText(
    'No movie, episode, season or series has the given ID.',
  )
  await expect(page.getByRole('button', { name: 'Mark watched', exact: true })).toBeEnabled()
})

const watchedEpisodes = Array.from({ length: 22 }, (_, index) => ({
  id: `e${index + 1}`,
  title: `Episode ${index + 1}`,
  episodeNumber: index + 1,
  runtime: 42,
  watchStatus: 'WATCHED' as const,
  watchProgress: null,
  files: [{ id: `file-e${index + 1}` }],
  stillImages: [],
}))

const watchedSeason: SeasonDetailQuery = {
  season: {
    id: 's1',
    title: 'Season 1',
    seasonNumber: 1,
    overview: null,
    airDate: null,
    watchStatus: 'WATCHED',
    series: {
      id: 'series-1',
      title: 'Longwatch',
      contentRating: null,
      directors: [],
      seasons: [
        {
          id: 's1',
          seasonNumber: 1,
          title: 'Season 1',
          watchStatus: 'WATCHED',
          episodes: watchedEpisodes.map(({ id }) => ({ id, watchStatus: 'WATCHED' as const })),
        },
      ],
      backdropImages: [],
    },
    episodes: watchedEpisodes,
    backdropImages: [],
    posterImages: [],
  },
}

test('the watched count stays on the progress bar when the whole season is watched', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName?: string }
    if (operationName !== 'SeasonDetail') return route.continue()
    return route.fulfill({ json: { data: watchedSeason } })
  })
  await page.goto('/season/s1')

  const bar = page.getByRole('progressbar', { name: '22 of 22 watched' })
  const count = bar.getByText('22 of 22 watched', { exact: true })
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 667 },
  ]) {
    await page.setViewportSize(viewport)
    const track = (await bar.boundingBox())!
    const pill = (await count.boundingBox())!
    expect(pill.x).toBeGreaterThanOrEqual(track.x)
    expect(pill.x + pill.width).toBeLessThanOrEqual(track.x + track.width)
  }
})
