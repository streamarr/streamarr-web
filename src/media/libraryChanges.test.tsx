import { screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { LibraryFieldsFragment } from '../graphql/generated/graphql'
import { watchingConnection, watchingMovie } from '../test/continueWatchingFixtures'
import { deferred } from '../test/deferred'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { meFixture, profileFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const VIEWER = meFixture({ scope: 'profile', profiles: [profileFixture({ selected: true })] })
const VIEWING_ADMIN = meFixture({
  scope: 'profile',
  serverAdmin: true,
  profiles: [profileFixture({ selected: true })],
})

const MOVIES: LibraryFieldsFragment = {
  __typename: 'Library',
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Movies',
  type: 'MOVIE',
  backend: 'LOCAL',
}

const SHOWS: LibraryFieldsFragment = {
  ...MOVIES,
  id: '22222222-2222-2222-2222-222222222222',
  name: 'TV shows',
  type: 'SERIES',
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
function serve(libraries = [MOVIES], me = VIEWER) {
  const state = {
    libraries,
    watching: [] as ReturnType<typeof watchingMovie>[],
    reads: { Libraries: 0, LibraryPage: 0 },
    socket: serveGraphqlSocket(),
  }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
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
          continueWatching: watchingConnection(state.watching),
          libraries: state.libraries.map((library) => ({ ...library, items: { edges: [] } })),
        },
      }),
    ),
  )
  return state
}

type Served = ReturnType<typeof serve>

async function openHome(state: Served) {
  renderAppAt('/')
  const nav = await screen.findByRole('navigation', { name: 'Primary' })
  await within(nav).findByRole('link', { name: 'Movies' })
  await waitFor(() => expect(state.socket.isLive('LibraryRemoved')).toBe(true))
}

function topBar() {
  return screen.getByRole('navigation', { name: 'Primary' })
}

function libraryOperations(state: Served) {
  return state.socket.state.subscribes.filter((name) => name.includes('Library')).sort()
}

function selectsAdministration(state: Served, operationName: string) {
  return /\badministration\b/.test(state.socket.state.documents.get(operationName) ?? '')
}

describe('subscribeToLibraryChanges', () => {
  it.each([
    ['AProfileWithoutServerAdministration', VIEWER],
    ['AServerAdminsDeviceBoundSession', { ...VIEWING_ADMIN, deviceBound: true }],
  ])('shouldWatchOnlyAdditionsAndRemovalsFor%s', async (_viewer, me) => {
    const state = serve([MOVIES], me)

    await openHome(state)

    await waitFor(() => expect(state.socket.isLive('LibraryAdded')).toBe(true))
    expect(libraryOperations(state)).toEqual(['LibraryAdded', 'LibraryRemoved'])
    expect(selectsAdministration(state, 'LibraryAdded')).toBe(false)
  })

  it('shouldListALibraryAddedWhileTheChangesMoveToServerAdministration', async () => {
    const state = serve()
    renderAppAt(`/library/${MOVIES.id}`)
    await screen.findByRole('heading', { name: 'Movies' })
    await waitFor(() => expect(state.socket.isLive('LibraryAdded')).toBe(true))
    const librariesReadBefore = state.reads.Libraries
    server.use(
      graphql.query('Me', async () => {
        // The grant reaches Me after the libraries read again, and the addition commits before
        // the administered changes subscribe, so no operation delivers it.
        await vi.waitFor(() => expect(state.reads.Libraries).toBeGreaterThan(librariesReadBefore))
        state.libraries = [MOVIES, SHOWS]
        return HttpResponse.json({ data: { me: VIEWING_ADMIN } })
      }),
    )

    window.dispatchEvent(new Event('online'))

    await waitFor(() => expect(state.socket.isLive('AdminLibraryAdded')).toBe(true))
    expect(await within(topBar()).findByRole('link', { name: 'TV shows' })).toBeInTheDocument()
  })

  it('shouldShowAPushedNameInTheTopBarForAServerAdmin', async () => {
    const state = serve([MOVIES], VIEWING_ADMIN)
    await openHome(state)
    await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
    expect(libraryOperations(state)).toEqual([
      'AdminLibraryAdded',
      'LibraryRemoved',
      'LibraryStatusChanged',
    ])
    expect(selectsAdministration(state, 'AdminLibraryAdded')).toBe(true)
    expect(selectsAdministration(state, 'LibraryStatusChanged')).toBe(true)

    state.socket.publish('LibraryStatusChanged', {
      data: {
        libraryStatusChanged: {
          ...MOVIES,
          name: 'Films',
          administration: {
            filepathUri: 'file:///media/movies',
            status: 'SCANNING',
            scanStartedOn: '2026-08-28T11:40:00Z',
            scanCompletedOn: null,
          },
        },
      },
    })

    expect(await within(topBar()).findByRole('link', { name: 'Films' })).toBeInTheDocument()
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

  it('shouldDropAContinueWatchingTitleWhenAPushedRemovalTakesItsLibrary', async () => {
    const state = serve([MOVIES, SHOWS])
    state.watching = [
      { ...watchingMovie({ id: 'Everlight', orderKey: null }), library: { ...MOVIES } },
    ]
    await openHome(state)
    expect(await screen.findByRole('link', { name: 'Resume' })).toBeInTheDocument()

    state.libraries = [SHOWS]
    state.watching = []
    state.socket.publish('LibraryRemoved', { data: { libraryRemoved: { libraryId: MOVIES.id } } })

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Resume' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('link', { name: /Everlight/ })).not.toBeInTheDocument()
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
})
