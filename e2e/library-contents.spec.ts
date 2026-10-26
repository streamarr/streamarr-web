import { watchingConnection } from '../src/test/continueWatchingFixtures'
import { LIBRARY, movie, addition as change, mediaEdge } from '../src/test/libraryContentsFixtures'
import { expect, test } from '@playwright/test'
import type { LibraryPageQuery } from '../src/graphql/generated/graphql'
import { meFixture, profileFixture } from '../src/test/meFixture'
import { routeGraphqlSocket } from './graphqlSocket'
import { STUB_URL } from './ports'

test.use({ serviceWorkers: 'block' })

const me = meFixture({ scope: 'profile', profiles: [profileFixture({ selected: true })] })

test('library frames update cards and counts through detail navigation and reconnect', async ({
  page,
  request,
}) => {
  const cacheWarnings: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('Cache data may be lost')) cacheWarnings.push(message.text())
  })
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  const socket = await routeGraphqlSocket(page)
  const nodes = [movie({ id: 'a', title: 'Alpha' }), movie({ id: 'd', title: 'Delta' })]
  let reads = 0
  const library = (): LibraryPageQuery => ({
    library: {
      ...{ __typename: 'Library' as const },
      id: LIBRARY,
      name: 'Movies',
      itemCount: 80,
      alphabetIndex: [
        { letter: 'A', count: 40 },
        { letter: 'D', count: 40 },
      ],
      items: {
        edges: nodes.map((node) => mediaEdge({ cursor: `cursor-${node.id}`, node })),
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: 'cursor-a',
          endCursor: 'cursor-d',
        },
      },
    },
  })
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName: string }
    const reply = (data: unknown) => route.fulfill({ json: { data } })
    if (operationName === 'Me') return reply({ me })
    if (operationName === 'Libraries') return reply({ libraries: [] })
    if (operationName === 'Home')
      return reply({ continueWatching: watchingConnection([]), libraries: [] })
    if (operationName === 'LibraryPage') {
      reads++
      return reply(library())
    }
    if (operationName === 'MovieDetail')
      return reply({
        movie: {
          ...nodes[0],
          tagline: null,
          summary: null,
          contentRating: null,
          genres: [],
          directors: [],
          cast: [],
          ratings: [],
          files: [],
          backdropImages: [],
          posterImages: [],
        },
      })
    return route.continue()
  })
  await page.goto(`/library/${LIBRARY}`)
  const grid = page.getByRole('grid', { name: 'Items' })
  await expect(grid.getByRole('link', { name: /Alpha/ })).toBeVisible()
  await expect.poll(() => socket.isLive('LibraryCountsChanged')).toBe(true)
  await page.waitForTimeout(250) // NOSONAR: settle startup recovery before asserting events cause no extra reads
  const initialReads = reads
  socket.publish('LibraryItemAdded', change({ id: 'b', title: 'Bravo' }))
  socket.publish('LibraryItemAdded', change({ id: 'b', title: 'Bravo' }))
  await expect(grid.getByRole('link', { name: /Bravo/ })).toHaveCount(1)
  expect(reads).toBe(initialReads)

  const update = change({ id: 'b', title: 'Bravo revised' })
  update.data.change.edge.cursor = 'revised-server-cursor'
  socket.publish('LibraryItemUpdated', update)
  socket.publish('LibraryCountsChanged', {
    data: {
      change: {
        __typename: 'Library',
        id: LIBRARY,
        itemCount: 81,
        alphabetIndex: [
          { letter: 'A', count: 40 },
          { letter: 'B', count: 1 },
          { letter: 'D', count: 40 },
        ],
      },
    },
  })
  await expect(grid.getByRole('link', { name: /Bravo revised/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All 81', exact: true })).toBeVisible()
  expect(reads).toBe(initialReads)

  await grid.getByRole('link', { name: /Alpha/ }).click()
  await expect(page.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible()
  socket.publish('LibraryItemRemoved', {
    data: {
      change: {
        __typename: 'LibraryItemRemoval',
        libraryId: LIBRARY,
        itemId: 'd',
        kind: 'MOVIE',
      },
    },
  })
  await page.goBack()
  await expect(grid.getByRole('link', { name: /Bravo revised/ })).toBeVisible()
  await expect(grid.getByRole('link', { name: /Delta/ })).toHaveCount(0)
  expect(reads).toBe(initialReads)
  expect(socket.state.connections).toBe(1)

  await grid.getByRole('link', { name: /Alpha/ }).click()
  await expect(page.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible()
  nodes.splice(1, 1, movie({ id: 'c', title: 'Charlie recovered' }))
  await socket.closeAll(1011)
  await expect.poll(() => socket.state.connections).toBe(2)
  await expect.poll(() => reads).toBe(initialReads + 1)
  await page.goBack()
  await expect(grid.getByRole('link', { name: /Charlie recovered/ })).toBeVisible()
  expect(reads).toBe(initialReads + 1)
  await page.goto('/')
  await expect.poll(() => socket.isLive('LibraryItemAdded')).toBe(false)
  expect(cacheWarnings).toEqual([])
})
