import { screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { LibraryFieldsFragment, LibraryStatus } from '../graphql/generated/graphql'
import { watchingConnection } from '../test/continueWatchingFixtures'
import { deferred } from '../test/deferred'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { meFixture, profileFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const VIEWER = meFixture({ scope: 'profile', profiles: [profileFixture({ selected: true })] })

const MOVIES: LibraryFieldsFragment = {
  __typename: 'Library',
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Movies',
  type: 'MOVIE',
  backend: 'LOCAL',
  filepathUri: 'file:///media/movies',
  status: 'HEALTHY',
  scanStartedOn: '2026-08-28T11:40:00Z',
  scanCompletedOn: '2026-08-28T11:46:00Z',
}

const SHOWS: LibraryFieldsFragment = {
  ...MOVIES,
  id: '22222222-2222-2222-2222-222222222222',
  name: 'TV shows',
  type: 'SERIES',
  filepathUri: 'file:///media/tv',
}

const EVERLIGHT_EDGE = {
  cursor: 'm1',
  node: {
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
    tagline: null,
    summary: null,
    createdOn: '2026-08-27T12:00:00Z',
    genres: [],
    files: [{ __typename: 'MediaFile', id: 'f1' }],
    backdropImages: [],
  },
}

const NO_ITEMS = {
  edges: [],
  pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
}

// Answers every read with the Libraries the server holds now, which a test changes before it
// publishes a change, and counts the reads by operation.
function serve(libraries = [MOVIES]) {
  const state = {
    libraries,
    reads: { Libraries: 0, LibraryPage: 0 },
    socket: serveGraphqlSocket(),
  }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: VIEWER } })),
    graphql.query('Libraries', () => {
      state.reads.Libraries++
      return HttpResponse.json({ data: { libraries: state.libraries } })
    }),
    graphql.query('LibraryPage', ({ variables }) => {
      state.reads.LibraryPage++
      const library = state.libraries.find((held) => held.id === variables.libraryId)
      return HttpResponse.json({
        data: { library: { ...library, itemCount: 0, alphabetIndex: [], items: NO_ITEMS } },
      })
    }),
    graphql.query('Home', () =>
      HttpResponse.json({
        data: {
          continueWatching: watchingConnection([]),
          libraries: state.libraries.map((library) => ({ ...library, items: { edges: [] } })),
        },
      }),
    ),
  )
  return state
}

type Served = ReturnType<typeof serve>

async function openMovies(state: Served) {
  renderAppAt(`/library/${MOVIES.id}`)
  await screen.findByRole('heading', { name: 'Movies' })
  await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
}

async function openHome(state: Served) {
  renderAppAt('/')
  const nav = await screen.findByRole('navigation', { name: 'Primary' })
  await within(nav).findByRole('link', { name: 'Movies' })
  await waitFor(() => expect(state.socket.isLive('LibraryRemoved')).toBe(true))
}

function topBar() {
  return screen.getByRole('navigation', { name: 'Primary' })
}

function statusChanged(library: LibraryFieldsFragment) {
  return { data: { libraryStatusChanged: library } }
}

describe('subscribeToLibraryChanges', () => {
  it('shouldShowEachStatusTheServerPushesWhileTheLibraryIsOpen', async () => {
    const state = serve()
    await openMovies(state)
    expect(screen.getByText(/^last scan \d+ weeks ago$/)).toBeInTheDocument()
    const readsBeforeChanges = { ...state.reads }

    const scanStartedOn = new Date().toISOString()
    state.socket.publish(
      'LibraryStatusChanged',
      statusChanged({ ...MOVIES, status: 'SCANNING', scanStartedOn }),
    )
    expect(await screen.findByText('scanning…')).toBeInTheDocument()

    state.socket.publish(
      'LibraryStatusChanged',
      statusChanged({ ...MOVIES, scanStartedOn, scanCompletedOn: new Date().toISOString() }),
    )
    expect(await screen.findByText('last scan just now')).toBeInTheDocument()
    expect(state.reads).toEqual(readsBeforeChanges)
  })

  it.each([
    ['REFRESHING', 'refreshing…'],
    ['STOPPING', 'stopping…'],
    ['UNHEALTHY', 'last operation failed'],
  ] satisfies [LibraryStatus, string][])(
    'shouldLabelTheLibraryFromAPushed%sStatus',
    async (status, label) => {
      const state = serve()
      await openMovies(state)

      state.socket.publish('LibraryStatusChanged', statusChanged({ ...MOVIES, status }))

      expect(await screen.findByText(label)).toBeInTheDocument()
      expect(screen.queryByText(/^last scan/)).not.toBeInTheDocument()
    },
  )

  it('shouldShowAPushedNameInTheTopBarAndTheLibraryHeader', async () => {
    const state = serve()
    await openMovies(state)

    state.socket.publish('LibraryStatusChanged', statusChanged({ ...MOVIES, name: 'Films' }))

    expect(await screen.findByRole('heading', { name: 'Films' })).toBeInTheDocument()
    expect(within(topBar()).getByRole('link', { name: 'Films' })).toBeInTheDocument()
  })

  it('shouldAddAPushedLibraryToTheTopBarOnceWhenItArrivesTwice', async () => {
    const state = serve()
    await openHome(state)
    const readsBeforeAddition = state.reads.Libraries

    state.libraries = [MOVIES, SHOWS]
    state.socket.publish('LibraryAdded', { data: { libraryAdded: SHOWS } })
    state.socket.publish('LibraryAdded', { data: { libraryAdded: SHOWS } })

    expect(await within(topBar()).findByRole('link', { name: 'TV shows' })).toBeInTheDocument()
    expect(within(topBar()).getAllByRole('link', { name: 'TV shows' })).toHaveLength(1)
    expect(state.reads.Libraries).toBe(readsBeforeAddition)
  })

  it('shouldKeepHomeOnScreenWhileItReadsAgainForAPushedLibrary', async () => {
    const state = serve()
    let homeReads = 0
    const secondRead = deferred()
    server.use(
      graphql.query('Home', async () => {
        homeReads++
        if (homeReads > 1) await secondRead.promise
        return HttpResponse.json({
          data: {
            continueWatching: watchingConnection([]),
            libraries: state.libraries.map((library) => ({
              ...library,
              items: { edges: library.id === MOVIES.id ? [EVERLIGHT_EDGE] : [] },
            })),
          },
        })
      }),
    )
    await openHome(state)
    const everlight = await screen.findByRole('heading', { name: 'Everlight' })

    state.libraries = [MOVIES, SHOWS]
    state.socket.publish('LibraryAdded', { data: { libraryAdded: SHOWS } })

    // Home's rails need the added Library's titles, which the change does not carry.
    await waitFor(() => expect(homeReads).toBe(2))
    expect(everlight).toBeInTheDocument()
    expect(within(topBar()).getByRole('link', { name: 'TV shows' })).toBeInTheDocument()
    secondRead.resolve()
    expect(await screen.findByRole('heading', { name: 'Everlight' })).toBeInTheDocument()
  })

  it('shouldDropAPushedRemovalFromTheTopBar', async () => {
    const state = serve([MOVIES, SHOWS])
    await openHome(state)
    const tvShows = within(topBar()).getByRole('link', { name: 'TV shows' })

    state.libraries = [MOVIES]
    state.socket.publish('LibraryRemoved', { data: { libraryRemoved: { libraryId: SHOWS.id } } })

    await waitFor(() => expect(tvShows).not.toBeInTheDocument())
    expect(within(topBar()).getByRole('link', { name: 'Movies' })).toBeInTheDocument()
  })

  it('shouldKeepARemovedLibraryOutOfTheTopBarWhenAnEarlierChangeArrivesAfterItsRemoval', async () => {
    const state = serve([MOVIES, SHOWS])
    await openHome(state)

    state.libraries = [MOVIES]
    state.socket.publish('LibraryRemoved', { data: { libraryRemoved: { libraryId: SHOWS.id } } })
    state.socket.publish('LibraryStatusChanged', statusChanged({ ...SHOWS, status: 'SCANNING' }))
    state.socket.publish('LibraryAdded', { data: { libraryAdded: SHOWS } })
    state.socket.publish('LibraryStatusChanged', statusChanged({ ...MOVIES, name: 'Films' }))

    await within(topBar()).findByRole('link', { name: 'Films' })
    expect(within(topBar()).queryByRole('link', { name: 'TV shows' })).not.toBeInTheDocument()
  })

  it('shouldShowTheStatusReadAgainAfterTheConnectionReturns', async () => {
    const state = serve()
    await openMovies(state)

    state.libraries = [{ ...MOVIES, status: 'REFRESHING' }]
    state.socket.closeAll(1001, 'Going away')

    expect(await screen.findByText('refreshing…', {}, { timeout: 3_000 })).toBeInTheDocument()
  })
})
