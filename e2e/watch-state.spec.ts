import { expect, test } from '@playwright/test'
import type { LibraryPageQuery } from '../src/graphql/generated/graphql'
import { mediaEdge } from '../src/test/libraryContentsFixtures'
import { meFixture, profileFixture } from '../src/test/meFixture'
import { routeGraphqlSocket } from './graphqlSocket'

test.use({ serviceWorkers: 'block' })

const LIBRARY_ID = '44444444-4444-4444-4444-444444444444'

function movie(id: string, title: string) {
  return {
    __typename: 'Movie' as const,
    id,
    title,
    titleSort: title,
    releaseDate: '2024-01-01',
    runtime: 100,
    watchStatus: 'UNWATCHED' as const,
    lastWatchedAt: null,
    watchProgress: null,
    images: [],
  }
}

const EVERLIGHT = movie('m1', 'Everlight')
const NORTHERN_LINE = movie('m2', 'Northern Line')

test('an Unwatched view drops a movie that another device finishes', async ({ page }) => {
  const me = meFixture({ scope: 'profile', profiles: [profileFixture({ selected: true })] })
  const socket = await routeGraphqlSocket(page)
  // A read after the change answers as the server would: without the finished movie.
  let finished = false
  let libraryPageRequests = 0
  const unwatched = (): LibraryPageQuery => ({
    library: {
      ...{ __typename: 'Library' as const },
      id: LIBRARY_ID,
      name: 'Movies',
      itemCount: 2,
      alphabetIndex: [],
      items: {
        edges: (finished ? [NORTHERN_LINE] : [EVERLIGHT, NORTHERN_LINE]).map((node) =>
          mediaEdge({ cursor: node.id, node }),
        ),
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
      },
    },
  })
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName: string }
    const reply = (data: unknown) => route.fulfill({ json: { data } })
    if (operationName === 'Me') return reply({ me })
    if (operationName === 'Libraries') return reply({ libraries: [] })
    if (operationName === 'LibraryPage') {
      libraryPageRequests += 1
      return reply(unwatched())
    }
    return route.continue()
  })

  await page.goto(`/library/${LIBRARY_ID}?watchStatus=UNWATCHED`)
  const grid = page.getByRole('grid', { name: 'Items' })
  await expect(grid.getByRole('link', { name: /Everlight/ })).toBeVisible()
  await expect.poll(() => socket.isLive('WatchStateChanged')).toBe(true)
  // The list reads once on entry and once more after the changes subscribe.
  await page.waitForTimeout(250) // NOSONAR: settle startup recovery before asserting events cause no extra reads
  const initialReads = libraryPageRequests

  finished = true
  socket.publish('WatchStateChanged', {
    data: {
      watchStateChanged: {
        continueWatching: [],
        __typename: 'WatchStateChange',
        items: [
          {
            ...EVERLIGHT,
            watchStatus: 'WATCHED',
            lastWatchedAt: '2026-10-16T10:00:00Z',
            unmatched: false,
            library: { __typename: 'Library', id: LIBRARY_ID },
          },
        ],
      },
    },
  })

  socket.publish('LibraryItemUpdated', {
    data: {
      change: {
        __typename: 'LibraryItemChange',
        libraryId: LIBRARY_ID,
        itemId: EVERLIGHT.id,
        kind: 'MOVIE',
        item: { ...EVERLIGHT, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T10:00:00Z' },
        edge: null,
      },
    },
  })

  await expect(grid.getByRole('link', { name: /Everlight/ })).toHaveCount(0)
  await expect(grid.getByRole('link', { name: /Northern Line/ })).toBeVisible()
  // The change itself drops the movie: the list is not read again.
  expect(libraryPageRequests).toBe(initialReads)
})
