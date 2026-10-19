import { LIBRARY, movie, edge, addition } from '../test/libraryContentsFixtures'
import { act, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse, type GraphQLQuery } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { meFixture, profileFixture } from '../test/meFixture'
import { renderAppAt, renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { LibraryContentsProvider } from './LibraryContentsProvider'
import { useLibraryItems } from './useLibraryItems'
import type {
  LibraryPageQueryVariables,
  MediaFilter,
  MediaSort,
} from '../graphql/generated/graphql'
import { useEffect } from 'react'

const WATCHER = meFixture({ scope: 'profile', profiles: [profileFixture({ selected: true })] })

function serve({
  edges = [edge({ id: 'a', title: 'Alpha' }), edge({ id: 'd', title: 'Delta' })],
  hasNextPage = true,
  hasPreviousPage = false,
  next = [] as ReturnType<typeof edge>[],
  pause = Promise.resolve(),
} = {}) {
  const reads = { library: 0 }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: WATCHER } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', async ({ variables }) => {
      reads.library++
      if (variables.after) await pause
      const page = variables.after ? next : edges
      return HttpResponse.json({
        data: {
          library: {
            __typename: 'Library',
            id: LIBRARY,
            name: 'Movies',
            status: 'HEALTHY',
            scanCompletedOn: '2026-10-18T11:00:00Z',
            itemCount: 80,
            alphabetIndex: [
              { letter: 'A', count: 40 },
              { letter: 'D', count: 40 },
            ],
            items: {
              edges: page,
              pageInfo: {
                hasPreviousPage,
                hasNextPage: !variables.after && hasNextPage,
                startCursor: page[0]?.cursor ?? null,
                endCursor: page.at(-1)?.cursor ?? null,
              },
            },
          },
        },
      })
    }),
  )
  return { reads, socket: serveGraphqlSocket() }
}

async function open(socket: ReturnType<typeof serveGraphqlSocket>) {
  const rendered = renderAppAt(`/library/${LIBRARY}`)
  await screen.findByRole('link', { name: /Alpha/ })
  await waitFor(() => expect(socket.isLive('LibraryItemAdded')).toBe(true))
  return rendered
}

function titles() {
  return within(screen.getByRole('grid', { name: 'Items' }))
    .getAllByRole('link')
    .map((link) => link.textContent?.split('2024')[0])
}

function Window({
  filter = {},
  sort = { by: 'TITLE', direction: 'ASC' },
}: {
  filter?: MediaFilter
  sort?: MediaSort
}) {
  const view = useLibraryItems({ libraryId: LIBRARY, sort, filter })
  const { staged, accept } = view
  useEffect(() => {
    if (staged) accept()
  }, [staged, accept])
  return (
    <>
      <p>{view.library?.itemCount} items</p>
      <output aria-label="Alphabet">
        {view.library?.alphabetIndex.map(({ letter, count }) => `${letter}:${count}`).join(',')}
      </output>
      <output aria-label="Landing">{view.landing?.cursor}</output>
      <ol aria-label="Loaded items">
        {view.edges.map(({ node }) => (
          <li key={node.id}>{node.title}</li>
        ))}
      </ol>
      <button onClick={view.loadMore}>More</button>
      <button onClick={view.retry}>Retry</button>
      <button
        onClick={() => {
          void view.loadPrevious()
        }}
      >
        Previous
      </button>
    </>
  )
}

async function openWindow(
  socket: ReturnType<typeof serveGraphqlSocket>,
  props: Parameters<typeof Window>[0] = {},
) {
  const result = renderWithProviders(
    <LibraryContentsProvider profileId="profile" pathname={`/library/${LIBRARY}`}>
      <Window {...props} />
    </LibraryContentsProvider>,
  )
  await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0))
  await waitFor(() => expect(socket.isLive('LibraryItemAdded')).toBe(true))
  return result
}

function loadedTitles() {
  return within(screen.getByRole('list', { name: 'Loaded items' }))
    .queryAllByRole('listitem')
    .map((item) => item.textContent)
}

function removal(id: string) {
  return {
    data: {
      change: { __typename: 'LibraryItemRemoval', libraryId: LIBRARY, itemId: id, kind: 'MOVIE' },
    },
  }
}

describe('library contents', () => {
  it.each(['FORBIDDEN', 'PROFILE_REQUIRED', 'TOO_MANY_OPERATIONS', 'INTERNAL_ERROR'])(
    'shouldShowATerminal%sRefusalUntilAnExplicitRetry',
    async (code) => {
      const { reads, socket } = serve()
      const { user } = await open(socket)
      await waitFor(() => expect(reads.library).toBe(2))
      act(() => {
        socket.publish('LibraryItemUpdated', {
          errors: [{ message: 'Access to this Library was refused.', extensions: { code } }],
        })
        socket.complete('LibraryItemUpdated')
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Access to this Library was refused.',
      )
      expect(
        screen.queryByText("This library doesn't exist or was removed."),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Alpha/ })).not.toBeInTheDocument()
      await waitFor(() => expect(socket.isLive('LibraryItemAdded')).toBe(false))
      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      await waitFor(() => expect(reads.library).toBe(3))
      expect(socket.isLive('LibraryItemAdded')).toBe(false)
      expect(screen.getByRole('alert')).toHaveTextContent('Access to this Library was refused.')
      await user.click(screen.getByRole('button', { name: 'Retry' }))
      expect(await screen.findByRole('link', { name: /Alpha/ })).toBeInTheDocument()
      await waitFor(() => expect(socket.isLive('LibraryItemAdded')).toBe(true))
    },
  )

  it('shouldOfferRetryInsteadOfRemovingTheLibraryWhenTheSocketEndsFatally', async () => {
    const { socket } = serve()
    const { user } = await open(socket)
    act(() => socket.closeAll(4400, 'Invalid operation'))
    expect(await screen.findByRole('alert')).not.toHaveTextContent(
      "This library doesn't exist or was removed.",
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: /Alpha/ })).toBeInTheDocument()
    await waitFor(() => expect(socket.isLive('LibraryItemAdded')).toBe(true))
  })

  it('shouldKeepANewerRefusalWhenAnEarlierViewRetryFinishes', async () => {
    const { reads, socket } = serve()
    const { user, router } = await open(socket)
    await waitFor(() => expect(reads.library).toBe(2))
    const refuse = (message: string) => {
      act(() => {
        socket.publish('LibraryItemUpdated', {
          errors: [{ message, extensions: { code: 'FORBIDDEN' } }],
        })
        socket.complete('LibraryItemUpdated')
      })
    }
    refuse('The earlier view was refused.')
    await screen.findByText('The earlier view was refused.')
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    let retryStarted = false
    server.use(
      graphql.query(
        'LibraryPage',
        async () => {
          retryStarted = true
          await pending
          return HttpResponse.json({
            data: {
              library: {
                __typename: 'Library',
                id: LIBRARY,
                name: 'Movies',
                status: 'HEALTHY',
                scanCompletedOn: null,
                itemCount: 80,
                alphabetIndex: [],
                items: {
                  edges: [edge({ id: 'a', title: 'Alpha' })],
                  pageInfo: {
                    hasNextPage: false,
                    hasPreviousPage: false,
                    startCursor: 'a',
                    endCursor: 'a',
                  },
                },
              },
            },
          })
        },
        { once: true },
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(retryStarted).toBe(true))
    await act(async () => {
      await router.navigate({
        to: '/library/$libraryId',
        params: { libraryId: LIBRARY },
        search: { by: 'TITLE', direction: 'DESC' },
      })
    })
    await waitFor(() => expect(socket.isLive('LibraryItemAdded')).toBe(true))
    refuse('The current view was refused.')
    await screen.findByText('The current view was refused.')
    await act(async () => {
      release()
      await pending
    })
    await waitFor(() => expect(reads.library).toBeGreaterThan(2))
    expect(screen.getByRole('alert')).toHaveTextContent('The current view was refused.')
    expect(socket.isLive('LibraryItemAdded')).toBe(false)
  })

  it.each(['clearStore', 'resetStore'] as const)(
    'shouldDiscardPrivateLibraryStateOn%s',
    async (reset) => {
      const edges = [edge({ id: 'a', title: 'Alpha' }), edge({ id: 'd', title: 'Delta' })]
      const { reads, socket } = serve({ edges })
      const { apolloClient } = await open(socket)
      await waitFor(() => expect(reads.library).toBe(2))
      const registrations = socket.state.subscribes.filter(
        (name) => name === 'LibraryItemAdded',
      ).length
      edges.splice(0, edges.length, edge({ id: 'b', title: 'Bravo' }))
      await act(async () => {
        await apolloClient[reset]()
      })
      await screen.findByRole('link', { name: /Bravo/ })
      expect(screen.queryByRole('link', { name: /Alpha/ })).not.toBeInTheDocument()
      await waitFor(() =>
        expect(
          socket.state.subscribes.filter((name) => name === 'LibraryItemAdded').length,
        ).toBeGreaterThan(registrations),
      )
    },
  )

  it('shouldUseTheRecoveredWindowForLiveAdditionsAndContinueInOrder', async () => {
    let dataset = ['Alpha', 'Delta', 'Foxtrot', 'Golf', 'Hotel', 'Zulu']
    const { socket } = serve()
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        const offset = variables.after
          ? dataset.findIndex((title) => `cursor-${title}` === variables.after) + 1
          : 0
        const page = dataset.slice(offset, offset + 2).map((title) => edge({ id: title, title }))
        return HttpResponse.json({
          data: {
            library: {
              __typename: 'Library',
              id: LIBRARY,
              name: 'Movies',
              status: 'HEALTHY',
              scanCompletedOn: null,
              itemCount: dataset.length,
              alphabetIndex: [],
              items: {
                edges: page,
                pageInfo: {
                  hasPreviousPage: offset > 0,
                  hasNextPage: offset + 2 < dataset.length,
                  startCursor: page[0]?.cursor ?? null,
                  endCursor: page.at(-1)?.cursor ?? null,
                },
              },
            },
          },
        })
      }),
    )
    const { user } = await openWindow(socket)
    await user.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() => expect(loadedTitles()).toEqual(['Alpha', 'Delta', 'Foxtrot', 'Golf']))
    dataset = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Foxtrot', 'Golf', 'Hotel', 'Zulu']
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(loadedTitles()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']))
    dataset.splice(5, 0, 'Fuego')
    act(() => {
      socket.publish('LibraryItemAdded', addition({ id: 'Fuego', title: 'Fuego' }))
      socket.publish('LibraryCountsChanged', {
        data: {
          change: {
            __typename: 'Library',
            id: LIBRARY,
            itemCount: 9,
            alphabetIndex: [],
          },
        },
      })
    })
    await screen.findByText('9 items')
    expect(loadedTitles()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    await user.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() =>
      expect(loadedTitles()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Foxtrot', 'Fuego']),
    )
  })

  it('shouldUseTheRecoveredStartBoundaryWhenPagingBackwards', async () => {
    let dataset = ['Alpha', 'Delta', 'Foxtrot', 'Golf', 'Hotel']
    const { socket } = serve()
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        const end = variables.before
          ? dataset.findIndex((title) => `cursor-${title}` === variables.before)
          : dataset.length
        const offset = Math.max(0, end - 2)
        const page = dataset.slice(offset, end).map((title) => edge({ id: title, title }))
        return HttpResponse.json({
          data: {
            library: {
              __typename: 'Library',
              id: LIBRARY,
              name: 'Movies',
              status: 'HEALTHY',
              scanCompletedOn: null,
              itemCount: dataset.length,
              alphabetIndex: [],
              items: {
                edges: page,
                pageInfo: {
                  hasPreviousPage: offset > 0,
                  hasNextPage: end < dataset.length,
                  startCursor: page[0]?.cursor ?? null,
                  endCursor: page.at(-1)?.cursor ?? null,
                },
              },
            },
          },
        })
      }),
    )
    const { user } = await openWindow(socket, { filter: { startLetter: 'G' } })
    await waitFor(() => expect(loadedTitles()).toEqual(['Delta', 'Foxtrot', 'Golf', 'Hotel']))
    dataset = ['Alpha', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel']
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(loadedTitles()).toEqual(['Echo', 'Foxtrot', 'Golf', 'Hotel']))
    dataset.splice(2, 0, 'Eagle')
    act(() => {
      socket.publish('LibraryItemAdded', addition({ id: 'Eagle', title: 'Eagle' }))
      socket.publish('LibraryCountsChanged', {
        data: {
          change: {
            __typename: 'Library',
            id: LIBRARY,
            itemCount: 7,
            alphabetIndex: [],
          },
        },
      })
    })
    await screen.findByText('7 items')
    expect(loadedTitles()).toEqual(['Echo', 'Foxtrot', 'Golf', 'Hotel'])
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() =>
      expect(loadedTitles()).toEqual(['Delta', 'Eagle', 'Echo', 'Foxtrot', 'Golf', 'Hotel']),
    )
  })

  it('shouldApplyHiddenTabEventsAndRevalidateWhenTheTabReturns', async () => {
    const { reads, socket } = serve()
    await open(socket)
    await waitFor(() => expect(reads.library).toBe(2))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => socket.publish('LibraryItemAdded', addition({ id: 'b', title: 'Bravo' })))
    await screen.findByRole('link', { name: /Bravo/ })
    expect(reads.library).toBe(2)
    visibility.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(reads.library).toBeGreaterThanOrEqual(3))
    visibility.mockRestore()
  })

  it('shouldNormalizeNewArtworkWithoutReadingTheLibraryAgain', async () => {
    const { reads, socket } = serve()
    await open(socket)
    await waitFor(() => expect(reads.library).toBe(2))
    const update = addition({ id: 'a', title: 'Alpha' })
    act(() =>
      socket.publish('LibraryItemUpdated', {
        data: {
          change: {
            ...update.data.change,
            item: {
              ...update.data.change.item,
              images: [
                {
                  __typename: 'Image',
                  aspectRatio: 0.67,
                  blurHash: null,
                  variants: [
                    {
                      __typename: 'ImageVariant',
                      id: 'poster',
                      size: 'W342',
                      width: 342,
                      height: 513,
                      url: '/api/images/new-poster.png',
                    },
                  ],
                },
              ],
            },
          },
        },
      }),
    )
    const poster = await screen.findByRole('img', { name: 'Alpha' })
    expect(poster).toHaveAttribute('src', '/api/images/new-poster.png')
    expect(reads.library).toBe(2)
  })

  it('shouldRecoverAPartialErrorPayloadWithoutTreatingItAsARemoval', async () => {
    const edges = [edge({ id: 'a', title: 'Alpha' }), edge({ id: 'd', title: 'Delta' })]
    const { reads, socket } = serve({ edges })
    await open(socket)
    await waitFor(() => expect(reads.library).toBe(2))
    edges[0] = edge({ id: 'a', title: 'Alpha recovered' })
    act(() =>
      socket.publish('LibraryItemUpdated', {
        data: { change: null },
        errors: [{ message: 'Position unavailable', path: ['change', 'position'] }],
      }),
    )
    await screen.findByRole('link', { name: /Alpha recovered/ })
    expect(reads.library).toBe(3)
    expect(socket.isLive('LibraryItemUpdated')).toBe(true)
  })

  it.each([undefined, 'FORBIDDEN'])(
    'shouldTreatCompletionAfterAFieldErrorAsRemovalFor%s',
    async (code) => {
      const { socket } = serve()
      await open(socket)
      act(() => {
        socket.publish('LibraryItemUpdated', {
          ...addition(),
          errors: [
            { message: 'Position unavailable', path: ['change', 'position'], extensions: { code } },
          ],
        })
        socket.complete('LibraryItemUpdated')
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(
        "This library doesn't exist or was removed.",
      )
    },
  )

  it('shouldOfferExplicitPaginationWhenRemovalsEmptyTheVisibleWindow', async () => {
    const { reads, socket } = serve({ next: [edge({ id: 'z', title: 'Zulu' })] })
    const { user } = await open(socket)
    await waitFor(() => expect(reads.library).toBe(2))
    act(() => {
      socket.publish('LibraryItemRemoved', removal('a'))
      socket.publish('LibraryItemRemoved', removal('d'))
    })
    const more = await screen.findByRole('button', { name: 'Load more titles' })
    expect(reads.library).toBe(2)
    await user.click(more)
    await screen.findByRole('link', { name: /Zulu/ })
    expect(reads.library).toBe(3)
  })

  it('shouldFinishAnInFlightPageWhenALiveRemovalDeletesItsBoundaryItem', async () => {
    let release!: () => void
    const pause = new Promise<void>((resolve) => {
      release = resolve
    })
    const { reads, socket } = serve({ next: [edge({ id: 'z', title: 'Zulu' })], pause })
    const { user } = await openWindow(socket)
    act(() => socket.publish('LibraryItemAdded', addition({ id: 'z', title: 'Zulu' })))
    expect(loadedTitles()).toEqual(['Alpha', 'Delta'])
    await user.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() => expect(reads.library).toBe(2))
    act(() => socket.publish('LibraryItemRemoved', removal('d')))
    await waitFor(() => expect(loadedTitles()).toEqual(['Alpha']))
    await act(async () => {
      release()
    })
    await waitFor(() => expect(loadedTitles()).toEqual(['Alpha', 'Zulu']))
    expect(reads.library).toBe(2)
  })

  it('shouldRetainChangesThroughMovieAndBackThenReleaseTheConsumerOnHome', async () => {
    const { reads, socket } = serve()
    server.use(
      graphql.query('MovieDetail', () =>
        HttpResponse.json({
          data: {
            movie: {
              ...movie({ id: 'a', title: 'Alpha' }),
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
          },
        }),
      ),
      graphql.query('Home', () =>
        HttpResponse.json({ data: { continueWatching: [], libraries: [] } }),
      ),
    )
    const { router, user } = await open(socket)
    await waitFor(() => expect(reads.library).toBe(2))
    const subscribed = socket.state.subscribes.filter((name) => name === 'LibraryItemAdded').length
    await user.click(screen.getByRole('link', { name: /Alpha/ }))
    await screen.findByRole('heading', { name: 'Alpha' })
    act(() => socket.publish('LibraryItemAdded', addition({ id: 'b', title: 'Bravo' })))
    await act(async () => {
      router.history.back()
    })
    await screen.findByRole('link', { name: /Bravo/ })
    expect(reads.library).toBe(2)
    expect(socket.state.subscribes.filter((name) => name === 'LibraryItemAdded')).toHaveLength(
      subscribed,
    )
    await act(async () => {
      await router.navigate({ to: '/' })
    })
    await waitFor(() => expect(socket.isLive('LibraryItemAdded')).toBe(false))
    expect(socket.isLive('WatchStateChanged')).toBe(true)
  })

  it('shouldRevalidateTheRetainedLibraryWhileDetailIsOpenWithoutReplacingItsConsumer', async () => {
    const edges = [edge({ id: 'a', title: 'Alpha' }), edge({ id: 'd', title: 'Delta' })]
    const { reads, socket } = serve({ edges })
    server.use(
      graphql.query('MovieDetail', () =>
        HttpResponse.json({
          data: {
            movie: {
              ...movie({ id: 'a', title: 'Alpha' }),
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
          },
        }),
      ),
    )
    const { router, user } = await open(socket)
    await waitFor(() => expect(reads.library).toBe(2))
    await user.click(screen.getByRole('link', { name: /Alpha/ }))
    await screen.findByRole('heading', { name: 'Alpha' })
    edges.splice(1, 0, edge({ id: 'b', title: 'Bravo' }))
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(reads.library).toBe(3))
    await act(async () => {
      router.history.back()
    })
    await screen.findByRole('link', { name: /Bravo/ })
    expect(reads.library).toBe(3)
  })

  it('shouldEndARemovedLibraryWithoutResubscribingOnRecoveryOrBack', async () => {
    const { reads, socket } = serve()
    const { router } = await open(socket)
    await waitFor(() => expect(reads.library).toBe(2))
    act(() => socket.complete('LibraryItemAdded'))
    await screen.findByText("This library doesn't exist or was removed.")
    await waitFor(() => expect(socket.isLive('LibraryCountsChanged')).toBe(false))
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await act(async () => {
      await router.navigate({
        to: '/library/$libraryId',
        params: { libraryId: LIBRARY },
        search: { by: 'TITLE', direction: 'ASC', watchStatus: 'UNWATCHED' },
      })
    })
    expect(screen.getByText("This library doesn't exist or was removed.")).toBeVisible()
    expect(socket.isLive('LibraryItemAdded')).toBe(false)
    expect(reads.library).toBe(2)
  })

  it('shouldGrowFortyEightToFortyNineAndLeaveFortySevenAfterRemovalsWithoutRefilling', async () => {
    const edges = Array.from({ length: 48 }, (_, i) =>
      edge({ id: String(i), title: `Title ${String(i).padStart(2, '0')}` }),
    )
    const { reads, socket } = serve({ edges })
    await openWindow(socket)
    act(() =>
      socket.publish('LibraryItemAdded', addition({ id: 'extra', title: 'Title 20 extra' })),
    )
    await waitFor(() => expect(loadedTitles()).toHaveLength(49))
    act(() => {
      socket.publish('LibraryItemRemoved', removal('20'))
      socket.publish('LibraryItemRemoved', removal('extra'))
      socket.publish('LibraryItemRemoved', removal('extra'))
    })
    await waitFor(() => expect(loadedTitles()).toHaveLength(47))
    expect(screen.getByText('80 items')).toBeVisible()
    expect(reads.library).toBe(1)
  })

  it('shouldDeferAnOutOfRangeAdditionButApplyItsAuthoritativeCounts', async () => {
    const { reads, socket } = serve()
    await openWindow(socket)
    act(() => {
      socket.publish('LibraryItemAdded', addition({ id: 'z', title: 'Zulu' }))
      socket.publish('LibraryCountsChanged', {
        data: {
          change: {
            __typename: 'Library',
            id: LIBRARY,
            itemCount: 81,
            alphabetIndex: [
              { letter: 'A', count: 40 },
              { letter: 'D', count: 40 },
              { letter: 'Z', count: 1 },
            ],
          },
        },
      })
    })
    await screen.findByText('81 items')
    expect(loadedTitles()).toEqual(['Alpha', 'Delta'])
    expect(screen.getByLabelText('Alphabet')).toHaveTextContent('A:40,D:40,Z:1')
    expect(reads.library).toBe(1)
  })

  it('shouldExtendAFullyLoadedListAndUseServerPositionsForComplexFiltersAndDescendingOrder', async () => {
    const { reads, socket } = serve({
      edges: [edge({ id: 'a', title: 'Alpha' })],
      hasNextPage: false,
    })
    await openWindow(socket, {
      sort: { by: 'ADDED', direction: 'DESC' },
      filter: { genreIds: ['drama'], years: [2024] },
    })
    const update = addition({ id: 'z', title: 'Zulu' })
    update.data.change.position.orderKey = '000-newest'
    act(() => socket.publish('LibraryItemAdded', update))
    await waitFor(() => expect(loadedTitles()).toEqual(['Zulu', 'Alpha']))
    update.data.change.position.matchesFilter = false
    act(() => socket.publish('LibraryItemUpdated', update))
    await waitFor(() => expect(loadedTitles()).toEqual(['Alpha']))
    expect(reads.library).toBe(1)
  })

  it('shouldRetainItsOriginalRangeWhenBoundaryItemsAreRemoved', async () => {
    const { reads, socket } = serve({ hasPreviousPage: true })
    await openWindow(socket)
    act(() => {
      socket.publish('LibraryItemRemoved', removal('a'))
      socket.publish('LibraryItemRemoved', removal('d'))
    })
    await waitFor(() => expect(loadedTitles()).toEqual([]))
    act(() => socket.publish('LibraryItemAdded', addition({ id: 'b', title: 'Bravo' })))
    await waitFor(() => expect(loadedTitles()).toEqual(['Bravo']))
    expect(reads.library).toBe(1)
  })

  it('shouldKeepTheFocusedCardMountedWhenItsServerCursorChanges', async () => {
    const { socket } = serve()
    await open(socket)
    const card = screen.getByRole('link', { name: /Alpha/ })
    act(() => card.focus())
    const update = addition({ id: 'a', title: 'Alpha revised' })
    update.data.change.position.cursor = 'new-server-cursor'
    act(() => socket.publish('LibraryItemUpdated', update))
    const revised = await screen.findByRole('link', { name: /Alpha revised/ })
    expect(revised).toBe(card)
    expect(revised).toHaveFocus()
  })

  it('shouldGrowTheLoadedRangeWithoutReadingAgainOrDuplicatingAnAddition', async () => {
    const { reads, socket } = serve()
    await open(socket)
    const initialReads = reads.library

    act(() => socket.publish('LibraryItemAdded', addition({ id: 'b', title: 'Bravo' })))
    await screen.findByRole('link', { name: /Bravo/ })
    act(() => socket.publish('LibraryItemAdded', addition({ id: 'b', title: 'Bravo' })))

    await waitFor(() => expect(titles()).toEqual(['Alpha', 'Bravo', 'Delta']))
    expect(reads.library).toBe(initialReads)
    expect(socket.openSockets()).toBe(1)
  })
})
