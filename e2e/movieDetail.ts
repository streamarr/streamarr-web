import { expect, type APIRequestContext, type Page } from '@playwright/test'
import type { MovieDetailQuery } from '../src/graphql/generated/graphql'
import { STUB_URL } from './ports'

export const movie: MovieDetailQuery & { movie: { __typename: 'Movie' } } = {
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

export async function openMovie(
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
