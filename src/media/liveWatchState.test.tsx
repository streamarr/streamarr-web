import { act, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { meFixture, profileFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const LIBRARY_ID = '44444444-4444-4444-4444-444444444444'
const WATCHER = meFixture({ scope: 'profile', profiles: [profileFixture({ selected: true })] })

const PROGRESS = {
  __typename: 'WatchProgress',
  positionSeconds: 600,
  percentComplete: 10,
  durationSeconds: 6000,
}

const EVERLIGHT_CARD = {
  __typename: 'Movie',
  id: 'm1',
  title: 'Everlight',
  titleSort: 'Everlight',
  releaseDate: '2024-01-01',
  runtime: 100,
  watchStatus: 'UNWATCHED',
  lastWatchedAt: null,
  watchProgress: null,
  images: [],
}

const NORTHERN_LINE_CARD = {
  ...EVERLIGHT_CARD,
  id: 'm2',
  title: 'Northern Line',
  titleSort: 'Northern Line',
}

const EVERLIGHT_DETAIL = {
  __typename: 'Movie',
  id: 'm1',
  title: 'Everlight',
  tagline: null,
  summary: null,
  runtime: 100,
  releaseDate: '2024-01-01',
  contentRating: null,
  genres: [],
  directors: [],
  cast: [],
  ratings: [],
  files: [{ __typename: 'MediaFile', id: 'f1' }],
  watchStatus: 'UNWATCHED',
  watchProgress: null,
  backdropImages: [],
  posterImages: [],
}

const CONTINUE_WATCHING_MOVIE = {
  __typename: 'Movie',
  id: 'm1',
  title: 'Everlight',
  tagline: null,
  summary: null,
  runtime: 100,
  createdOn: '2026-08-26T12:00:00Z',
  lastWatchedAt: '2026-10-16T09:00:00Z',
  genres: [],
  images: [],
  watchProgress: PROGRESS,
  files: [{ __typename: 'MediaFile', id: 'f1' }],
}

const RECENTLY_ADDED = {
  __typename: 'Library',
  id: LIBRARY_ID,
  name: 'Movies',
  type: 'MOVIE',
  items: {
    edges: [
      {
        cursor: 'm2',
        node: {
          ...NORTHERN_LINE_CARD,
          tagline: null,
          summary: null,
          createdOn: '2026-08-27T12:00:00Z',
          genres: [],
          files: [{ __typename: 'MediaFile', id: 'f2' }],
          backdropImages: [],
        },
      },
    ],
  },
}

type SavedWatchState = { watchStatus?: string; watchProgress?: unknown }

// Answers every read with the watch state the server has saved, which a test changes before it
// publishes the change, and counts the reads by operation.
function serve(me = WATCHER) {
  const saved: Record<string, SavedWatchState> = {}
  const withSaved = <T extends { id: string }>(item: T) => ({ ...item, ...saved[item.id] })
  const reads: Record<string, number> = {}
  const count = (operationName: string) => {
    reads[operationName] = (reads[operationName] ?? 0) + 1
  }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('LibraryPage', () => {
      count('LibraryPage')
      return HttpResponse.json({
        data: {
          library: {
            __typename: 'Library',
            id: LIBRARY_ID,
            name: 'Movies',
            status: 'HEALTHY',
            scanCompletedOn: '2026-08-28T11:46:00Z',
            alphabetIndex: [
              { letter: 'E', count: 1 },
              { letter: 'N', count: 1 },
            ],
            items: {
              edges: [
                { cursor: 'm1', node: withSaved(EVERLIGHT_CARD) },
                { cursor: 'm2', node: withSaved(NORTHERN_LINE_CARD) },
              ],
              pageInfo: {
                hasNextPage: false,
                hasPreviousPage: false,
                startCursor: 'm1',
                endCursor: 'm2',
              },
            },
          },
        },
      })
    }),
    graphql.query('MovieDetail', () => {
      count('MovieDetail')
      return HttpResponse.json({ data: { movie: withSaved(EVERLIGHT_DETAIL) } })
    }),
    graphql.query('Home', () => {
      count('Home')
      return HttpResponse.json({
        data: {
          continueWatching: [withSaved(CONTINUE_WATCHING_MOVIE)],
          libraries: [
            {
              ...RECENTLY_ADDED,
              items: {
                edges: RECENTLY_ADDED.items.edges.map((edge) => ({
                  ...edge,
                  node: withSaved(edge.node),
                })),
              },
            },
          ],
        },
      })
    }),
  )
  return { reads, saved, socket: serveGraphqlSocket() }
}

type Item = Record<string, unknown> | null

function change(items: Item[]) {
  return { data: { watchStateChanged: { __typename: 'WatchStateChange', items } } }
}

function movie(id: string, watchStatus: string, watchProgress: unknown = null): Item {
  return { __typename: 'Movie', id, watchStatus, watchProgress }
}

async function openLibrary(socket: ReturnType<typeof serveGraphqlSocket>) {
  const rendered = renderAppAt(`/library/${LIBRARY_ID}`)
  await screen.findByRole('link', { name: /Everlight/ })
  await waitFor(() => expect(socket.isLive('WatchStateChanged')).toBe(true))
  return rendered
}

function cardFor(title: RegExp) {
  return screen.getByRole('link', { name: title })
}

describe('live watch state', () => {
  it('shouldUpdateTheCardAndTheDetailFromAChangeWithoutReadingEitherAgain', async () => {
    const { reads, saved, socket } = serve()
    const { router } = await openLibrary(socket)
    await act(async () => {
      await router.navigate({ to: '/movie/$movieId', params: { movieId: 'm1' } })
    })
    await screen.findByRole('button', { name: 'Mark watched' })
    const readsBeforeChange = { ...reads }

    saved.m1 = { watchStatus: 'WATCHED' }
    socket.publish('WatchStateChanged', change([movie('m1', 'WATCHED')]))

    await screen.findByRole('button', { name: 'Mark unwatched' })
    await act(async () => {
      router.history.back()
    })
    await waitFor(() =>
      expect(within(cardFor(/Everlight/)).getByLabelText('Watched')).toBeVisible(),
    )
    expect(reads).toEqual(readsBeforeChange)
  })

  it('shouldMoveTheContinueWatchingResumePositionFromAChange', async () => {
    const { reads, saved, socket } = serve()
    renderAppAt('/')
    const card = await screen.findByRole('link', { name: /Everlight/ })
    expect(card).toHaveAttribute('href', '/play/f1?movie=m1&position=600')
    await waitFor(() => expect(socket.isLive('WatchStateChanged')).toBe(true))
    const readsBeforeChange = { ...reads }
    const progress = { ...PROGRESS, positionSeconds: 3000, percentComplete: 50 }

    saved.m1 = { watchStatus: 'IN_PROGRESS', watchProgress: progress }
    socket.publish('WatchStateChanged', change([movie('m1', 'IN_PROGRESS', progress)]))

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Everlight/ })).toHaveAttribute(
        'href',
        '/play/f1?movie=m1&position=3000',
      ),
    )
    expect(reads).toEqual(readsBeforeChange)
  })

  it('shouldApplyTheOtherItemsWhenOneItemOfAChangeIsNull', async () => {
    const { saved, socket } = serve()
    await openLibrary(socket)

    saved.m2 = { watchStatus: 'WATCHED' }
    socket.publish('WatchStateChanged', {
      ...change([null, movie('m2', 'WATCHED')]),
      errors: [{ message: 'Timed out', path: ['watchStateChanged', 'items', 0, 'watchStatus'] }],
    })

    await waitFor(() =>
      expect(within(cardFor(/Northern Line/)).getByLabelText('Watched')).toBeVisible(),
    )
    expect(within(cardFor(/Everlight/)).queryByLabelText('Watched')).not.toBeInTheDocument()
  })

  it('shouldReadTheActiveQueriesAgainOnceAfterAChangeWithAFailedField', async () => {
    const { reads, socket } = serve()
    await openLibrary(socket)
    const readsBeforeChange = reads.LibraryPage

    socket.publish('WatchStateChanged', {
      ...change([null]),
      errors: [{ message: 'Timed out', path: ['watchStateChanged', 'items', 0, 'watchStatus'] }],
    })

    await waitFor(() => expect(reads.LibraryPage).toBe(readsBeforeChange + 1))
    await screen.findByRole('link', { name: /Everlight/ })
    expect(reads.LibraryPage).toBe(readsBeforeChange + 1)
  })

  it('shouldChangeNothingAndKeepListeningWhenAWholeChangeIsNull', async () => {
    const { saved, socket } = serve()
    await openLibrary(socket)

    socket.publish('WatchStateChanged', {
      data: { watchStateChanged: null },
      errors: [{ message: 'Timed out', path: ['watchStateChanged', 'items'] }],
    })
    saved.m2 = { watchStatus: 'WATCHED' }
    socket.publish('WatchStateChanged', change([movie('m2', 'WATCHED')]))

    await waitFor(() =>
      expect(within(cardFor(/Northern Line/)).getByLabelText('Watched')).toBeVisible(),
    )
    expect(within(cardFor(/Everlight/)).queryByLabelText('Watched')).not.toBeInTheDocument()
    expect(socket.state.subscribes.filter((name) => name === 'WatchStateChanged')).toHaveLength(1)
  })

  it('shouldNotListenForWatchStateChangesBeforeAProfileIsSelected', async () => {
    const { socket } = serve(meFixture({ scope: 'account' }))
    renderAppAt('/select-profile')
    await screen.findByRole('button', { name: /Alex/ })

    expect(socket.state.connections).toBe(0)
  })
})
