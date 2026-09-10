import { expect, test } from '@playwright/test'
import type { LibraryPageQuery, LibraryPageQueryVariables } from '../src/graphql/generated/graphql'
import { STUB_URL } from './ports'

// Use real layout and IntersectionObserver; intercept only the library API response.
test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })

const movies = Array.from({ length: 26 * 12 }, (_, index) => {
  const title = `${String.fromCharCode(65 + Math.floor(index / 12))} Title ${String(index % 12).padStart(2, '0')}`
  return {
    __typename: 'Movie' as const,
    id: String(index), title, titleSort: title, releaseDate: '2024-01-01', runtime: 90,
    watchStatus: 'UNWATCHED' as const, watchProgress: null, images: [],
  }
})

function libraryPage(variables: LibraryPageQueryVariables): LibraryPageQuery {
  const start = variables.before ? Math.max(0, Number(variables.before) - (variables.last ?? 48))
    : variables.after ? Number(variables.after) + 1
      : variables.filter?.startLetter ? (variables.filter.startLetter.charCodeAt(0) - 65) * 12 : 0
  const end = variables.before ? Number(variables.before) : Math.min(movies.length, start + (variables.first ?? 48))
  const nodes = movies.slice(start, end)
  const metadata = { __typename: 'Library' as const, id: 'movies', name: 'Movies' }
  return { library: {
    ...metadata,
    status: 'HEALTHY', scanCompletedOn: null,
    alphabetIndex: Array.from({ length: 26 }, (_, index) => ({
      letter: String.fromCharCode(65 + index) as LibraryPageQuery['library']['alphabetIndex'][number]['letter'],
      count: 12,
    })),
    items: {
      edges: nodes.map((node) => ({ cursor: node.id, node })),
      pageInfo: {
        hasNextPage: end < movies.length, hasPreviousPage: start > 0,
        startCursor: nodes[0]?.id ?? null, endCursor: nodes.at(-1)?.id ?? null,
      },
    },
  } }
}

test('a letter jump stays on its target when the earlier page arrives', async ({ page, request }) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  let releaseBackfill!: () => void
  const backfill = new Promise<void>((resolve) => { releaseBackfill = resolve })
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as { operationName: string; variables: LibraryPageQueryVariables }
    if (operation.operationName !== 'LibraryPage') return route.continue()
    if (operation.variables.before) await backfill
    await route.fulfill({ json: { data: libraryPage(operation.variables) } })
  })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'N', exact: true }).click()
  await expect(page.getByText('N Title 00', { exact: true })).toBeInViewport()
  releaseBackfill()
  await expect(page.getByText('J Title 00', { exact: true })).toBeAttached()
  await expect(page.getByText('N Title 00', { exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'T', exact: true }).click()
  await expect(page.getByText('P Title 00', { exact: true })).toBeAttached()
  await expect(page.getByText('T Title 00', { exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'N', exact: true }).click()
  await expect(page.getByText('F Title 00', { exact: true })).toBeAttached()
  await expect(page.getByText('N Title 00', { exact: true })).toBeInViewport()
})
