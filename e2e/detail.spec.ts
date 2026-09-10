import { expect, test } from '@playwright/test'
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

test('cast artwork stays portrait-shaped in the shared shelf on desktop and a phone', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    if (route.request().postDataJSON().operationName !== 'MovieDetail') return route.continue()
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
