import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse, type GraphQLQuery } from 'msw'
import { useApolloClient } from '@apollo/client/react'
import { useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'
import type {
  LibraryPageQuery,
  LibraryPageQueryVariables,
  MediaFilter,
  MediaSort,
} from '../graphql/generated/graphql'
import { LibraryContentsProvider } from './LibraryContentsProvider'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { useLibraryItems } from './useLibraryItems'

const LIBRARY_ID = '11111111-1111-1111-1111-111111111111'
const TITLE_ASC: MediaSort = { by: 'TITLE', direction: 'ASC' }

function movieNode(id: string, title: string) {
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

function libraryResponse(overrides: {
  edges: { cursor: string; node: ReturnType<typeof movieNode> }[]
  hasNextPage?: boolean
  hasPreviousPage?: boolean
  startCursor?: string | null
  endCursor?: string | null
  alphabetIndex?: LibraryPageQuery['library']['alphabetIndex']
}): LibraryPageQuery & { library: { __typename: 'Library' } } {
  return {
    library: {
      __typename: 'Library',
      id: LIBRARY_ID,
      name: 'Movies',
      status: 'HEALTHY',
      scanCompletedOn: '2026-08-28T11:00:00Z',
      itemCount: 2,
      alphabetIndex: overrides.alphabetIndex ?? [
        { letter: 'A', count: 1 },
        { letter: 'N', count: 1 },
      ],
      items: {
        edges: overrides.edges.map((edge) => ({
          __typename: 'MediaEdge' as const,
          ...edge,
          orderKey: edge.node.title,
        })),
        pageInfo: {
          hasNextPage: overrides.hasNextPage ?? false,
          hasPreviousPage: overrides.hasPreviousPage ?? false,
          startCursor: overrides.startCursor ?? overrides.edges[0]?.cursor ?? null,
          endCursor: overrides.endCursor ?? overrides.edges.at(-1)?.cursor ?? null,
        },
      },
    },
  }
}

function movieEdges(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    cursor: `c${index}`,
    node: movieNode(String(index), `Title ${String(index).padStart(3, '0')}`),
  }))
}

function Harness({
  initialFilter = {},
  initialColumns = 1,
}: {
  initialFilter?: MediaFilter
  initialColumns?: number | null
}) {
  const [filter, setFilter] = useState<MediaFilter>(initialFilter)
  const [columns, setColumns] = useState(initialColumns)
  const result = useLibraryItems({ libraryId: LIBRARY_ID, sort: TITLE_ASC, filter, columns })
  const client = useApolloClient()
  const [cachedTitles, setCachedTitles] = useState<number | null>(null)
  // A screen without motion: every staged result is shown as soon as it arrives.
  const { staged, accept } = result
  useEffect(() => {
    if (staged) accept()
  }, [staged, accept])
  return (
    <div>
      <div data-testid="loading">{String(result.loading)}</div>
      <div data-testid="hasNextPage">{String(result.hasNextPage)}</div>
      <div data-testid="hasPreviousPage">{String(result.hasPreviousPage)}</div>
      <div data-testid="landing">{result.landing?.cursor ?? ''}</div>
      <div data-testid="firstPosition">{result.firstPosition}</div>
      <div data-testid="cachedTitles">{cachedTitles}</div>
      <button
        type="button"
        onClick={() =>
          setCachedTitles(
            Object.keys(client.cache.extract() as Record<string, unknown>).filter((id) =>
              id.startsWith('Movie:'),
            ).length,
          )
        }
      >
        Count cached titles
      </button>
      <div data-testid="counts">
        {result.library?.itemCount}{' '}
        {result.library?.alphabetIndex.map((entry) => `${entry.letter}:${entry.count}`).join(',')}
      </div>
      <ul>
        {result.edges.map((edge) => (
          <li key={edge.cursor}>{edge.node.title}</li>
        ))}
      </ul>
      <button type="button" onClick={result.loadMore}>
        Load more
      </button>
      <button type="button" onClick={result.loadPrevious}>
        Load previous
      </button>
      <button type="button" onClick={() => setFilter({ startLetter: 'N' })}>
        Jump to N
      </button>
      <button type="button" onClick={() => setFilter({ startLetter: 'A' })}>
        Jump to A
      </button>
      <button type="button" onClick={() => setFilter({ watchStatus: 'UNWATCHED' })}>
        Unwatched only
      </button>
      <button type="button" onClick={() => setColumns(5)}>
        Measure five columns
      </button>
      <button type="button" onClick={() => result.unloadFarFrom({ first: 0, last: 0 })}>
        View the first title
      </button>
      <button type="button" onClick={() => result.unloadFarFrom({ first: 250, last: 250 })}>
        View the 251st title
      </button>
      <button
        type="button"
        onClick={() => {
          const last = result.edges.length - 1
          result.unloadFarFrom({ first: last, last })
        }}
      >
        View the last title
      </button>
    </div>
  )
}

// A retained library view, as the authenticated layout keeps it.
function LiveHarness({ filter }: { filter: MediaFilter }) {
  const result = useLibraryItems({ libraryId: LIBRARY_ID, sort: TITLE_ASC, filter, columns: 1 })
  return (
    <div>
      <div data-testid="landing">{result.landing?.cursor ?? ''}</div>
      <ul>
        {result.edges.map((edge) => (
          <li key={edge.cursor}>{edge.node.title}</li>
        ))}
      </ul>
    </div>
  )
}

// A library of `count` titles served by cursor, as the server pages it in either direction.
function serveLibraryOf(count: number) {
  const titles = movieEdges(count)
  const requested: LibraryPageQueryVariables[] = []
  const served = { count: 0 }
  const positionOf = (cursor: string) => Number(cursor.slice(1))
  server.use(
    graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
      requested.push(variables)
      let start = 0
      if (variables.after) start = positionOf(variables.after) + 1
      if (variables.before)
        start = Math.max(0, positionOf(variables.before) - (variables.last ?? 0))
      const end = variables.before
        ? positionOf(variables.before)
        : Math.min(count, start + (variables.first ?? 0))
      served.count += 1
      return HttpResponse.json({
        data: libraryResponse({
          edges: titles.slice(start, end),
          hasPreviousPage: start > 0,
          hasNextPage: end < count,
        }),
      })
    }),
  )
  return { requested, served }
}

function liveAddition(id: string, title: string) {
  return {
    data: {
      change: {
        __typename: 'LibraryItemChange',
        libraryId: LIBRARY_ID,
        itemId: id,
        kind: 'MOVIE',
        item: movieNode(id, title),
        edge: { __typename: 'MediaEdge', cursor: id, orderKey: title, node: movieNode(id, title) },
      },
    },
  }
}

async function loadTitlesThrough(user: ReturnType<typeof userEvent.setup>, title: string) {
  await screen.findByText('Title 000')
  while (!screen.queryByText(title)) {
    const loaded = screen.getAllByRole('listitem').length
    await user.click(screen.getByText('Load more'))
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(loaded))
  }
}

describe('useLibraryItems', () => {
  it('lands on a rendered item when the seek page starts with missing media', async () => {
    const response = libraryResponse({ edges: [{ cursor: 'o', node: movieNode('o', 'Ocean') }] })
    // The first N item no longer resolves; the seek continues at the next available title.
    response.library.items.edges = [
      null,
      { cursor: 'missing-n', orderKey: 'N', node: null },
      ...response.library.items.edges!,
    ]
    server.use(graphql.query('LibraryPage', () => HttpResponse.json({ data: response })))
    renderWithProviders(<Harness initialFilter={{ startLetter: 'N' }} />)
    await screen.findByText('Ocean')
    await waitFor(() => expect(screen.getByTestId('landing')).toHaveTextContent('o'))
  })

  it('shouldKeepTheFirstResolvedLandingWhenEarlierRowsArePrepended', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        const earlier = Boolean(variables.before)
        return HttpResponse.json({
          data: libraryResponse({
            edges: [
              {
                cursor: earlier ? 'm' : 'o',
                node: movieNode(earlier ? 'm' : 'o', earlier ? 'Middle' : 'Ocean'),
              },
            ],
            hasPreviousPage: !earlier,
          }),
        })
      }),
    )
    renderWithProviders(<Harness initialFilter={{ startLetter: 'N' }} />)
    await screen.findByText('Middle')
    expect(screen.getByTestId('landing')).toHaveTextContent('o')
  })

  it('returns to the requested letter after revisiting a cached, backfilled page', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        const title = variables.before
          ? 'Middle'
          : variables.filter?.startLetter === 'N'
            ? 'Northern'
            : 'Alpha'
        return HttpResponse.json({
          data: libraryResponse({
            edges: [{ cursor: title, node: movieNode(title, title) }],
            hasPreviousPage: title === 'Northern',
          }),
        })
      }),
    )
    const { user } = renderWithProviders(<Harness />)
    await screen.findByText('Alpha', { selector: 'li' })
    await user.click(screen.getByText('Jump to N'))
    await screen.findByText('Middle', { selector: 'li' })
    await user.click(screen.getByText('Jump to A'))
    await screen.findByText('Alpha', { selector: 'li' })
    await user.click(screen.getByText('Jump to N'))
    await screen.findByText('Middle', { selector: 'li' })
    expect(screen.getByTestId('landing')).toHaveTextContent('Northern')
  })

  it('shouldNotLoadTheTitlesBeforeALetterAgainWhenItsWindowAlreadyHasThem', async () => {
    let backwardFetches = 0
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.before) backwardFetches += 1
        const title = variables.before
          ? 'Middle'
          : variables.filter?.startLetter === 'N'
            ? 'Northern'
            : 'Alpha'
        return HttpResponse.json({
          data: libraryResponse({
            edges: [{ cursor: title, node: movieNode(title, title) }],
            hasPreviousPage: title !== 'Alpha',
          }),
        })
      }),
    )
    const { user } = renderWithProviders(<Harness />)
    await screen.findByText('Alpha', { selector: 'li' })
    await user.click(screen.getByText('Jump to N'))
    await screen.findByText('Middle', { selector: 'li' })
    await user.click(screen.getByText('Jump to A'))
    await screen.findByText('Alpha', { selector: 'li' })

    await user.click(screen.getByText('Jump to N'))

    await screen.findByText('Middle', { selector: 'li' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(backwardFetches).toBe(1)
  })

  it.each(['forward', 'backward'])(
    'ignores a %s page from the old filter after switching to Unwatched',
    async (direction) => {
      let release!: () => void
      const pending = new Promise<void>((resolve) => {
        release = resolve
      })
      let requested = false
      server.use(
        graphql.query<GraphQLQuery, LibraryPageQueryVariables>(
          'LibraryPage',
          async ({ variables }) => {
            if (variables.after || variables.before) {
              requested = true
              await pending
              return HttpResponse.json({
                data: libraryResponse({
                  edges: [{ cursor: 'old', node: movieNode('old', 'Old filtered-out title') }],
                }),
              })
            }
            return HttpResponse.json({
              data: libraryResponse({
                edges: variables.filter?.watchStatus
                  ? [{ cursor: 'unwatched', node: movieNode('unwatched', 'Unwatched title') }]
                  : [{ cursor: 'first', node: movieNode('first', 'First page') }],
                hasNextPage: !variables.filter?.watchStatus && direction === 'forward',
                hasPreviousPage: !variables.filter?.watchStatus && direction === 'backward',
              }),
            })
          },
        ),
      )
      const { user } = renderWithProviders(<Harness />)
      await screen.findByText('First page')
      await user.click(screen.getByText(direction === 'forward' ? 'Load more' : 'Load previous'))
      await waitFor(() => expect(requested).toBe(true))
      await user.click(screen.getByText('Unwatched only'))
      await screen.findByText('Unwatched title')
      await act(async () => {
        release()
        await new Promise((resolve) => setTimeout(resolve, 100))
      })
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'Unwatched title',
      ])
    },
  )

  it('loads the initial page', async () => {
    server.use(
      graphql.query('LibraryPage', () =>
        HttpResponse.json({
          data: libraryResponse({ edges: [{ cursor: 'c1', node: movieNode('1', 'Everlight') }] }),
        }),
      ),
    )

    renderWithProviders(<Harness />)

    await waitFor(() => expect(screen.getByText('Everlight')).toBeInTheDocument())
  })

  it('appends edges on loadMore and stops once hasNextPage is false', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.after) {
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c2', node: movieNode('2', 'Northern Line') }],
              hasNextPage: false,
            }),
          })
        }
        return HttpResponse.json({
          data: libraryResponse({
            edges: [{ cursor: 'c1', node: movieNode('1', 'Everlight') }],
            hasNextPage: true,
          }),
        })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByTestId('hasNextPage')).toHaveTextContent('true'))

    await user.click(screen.getByText('Load more'))

    await waitFor(() => expect(screen.getByText('Northern Line')).toBeInTheDocument())
    expect(screen.getByText('Everlight')).toBeInTheDocument()
    expect(screen.getByTestId('hasNextPage')).toHaveTextContent('false')
  })

  it('replaces edges with the seek page, issues one backward fetch dropping startLetter, and records the jump target to scroll to', async () => {
    let backwardFetches = 0
    let backwardFilter: unknown
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.before) {
          backwardFetches += 1
          backwardFilter = variables.filter
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c-before', node: movieNode('0', 'Alright') }],
              hasPreviousPage: false,
            }),
          })
        }
        if (variables.filter?.startLetter === 'N') {
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c-n', node: movieNode('3', 'Northern Line') }],
              hasPreviousPage: true,
              startCursor: 'c-n',
            }),
          })
        }
        return HttpResponse.json({
          data: libraryResponse({ edges: [{ cursor: 'c1', node: movieNode('1', 'Everlight') }] }),
        })
      }),
    )

    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByText('Everlight')).toBeInTheDocument())

    await user.click(screen.getByText('Jump to N'))

    // The seek node remains the landing target once the continuity page has rendered above it.
    await waitFor(() => expect(screen.getByTestId('landing')).toHaveTextContent('c-n'))
    await waitFor(() => expect(screen.getByText('Alright')).toBeInTheDocument())
    expect(screen.getByText('Northern Line')).toBeInTheDocument()
    expect(backwardFetches).toBe(1)
    // Once paginating via `before`, the seek anchor has nothing left to do (ADR 0023) — dropped,
    // matching streamarr-apple's fetchPreviousPage.
    expect(backwardFilter).toEqual({})
  })

  it('keeps loading previous pages on repeated loadPrevious calls, all the way back to the start', async () => {
    let backwardCallCount = 0
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.before === 'c-n') {
          backwardCallCount += 1
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c-m', node: movieNode('m', 'Mid Title') }],
              hasPreviousPage: true,
              startCursor: 'c-m',
            }),
          })
        }
        if (variables.before === 'c-m') {
          backwardCallCount += 1
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c-a', node: movieNode('a', 'Alright') }],
              hasPreviousPage: false,
            }),
          })
        }
        if (variables.filter?.startLetter === 'N') {
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c-n', node: movieNode('n', 'Northern Line') }],
              hasPreviousPage: true,
              startCursor: 'c-n',
            }),
          })
        }
        return HttpResponse.json({
          data: libraryResponse({ edges: [{ cursor: 'c1', node: movieNode('1', 'Everlight') }] }),
        })
      }),
    )

    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByText('Everlight')).toBeInTheDocument())

    await user.click(screen.getByText('Jump to N'))
    // The one-shot centering fetch lands on "Mid Title", still with more before it.
    await waitFor(() => expect(screen.getByText('Mid Title')).toBeInTheDocument())
    expect(screen.getByTestId('hasPreviousPage')).toHaveTextContent('true')
    expect(backwardCallCount).toBe(1)

    // Scrolling further up keeps going, exactly like loadMore does for the forward direction.
    await user.click(screen.getByText('Load previous'))

    await waitFor(() => expect(screen.getByText('Alright')).toBeInTheDocument())
    expect(screen.getByText('Mid Title')).toBeInTheDocument()
    expect(screen.getByText('Northern Line')).toBeInTheDocument()
    expect(screen.getByTestId('hasPreviousPage')).toHaveTextContent('false')
    expect(backwardCallCount).toBe(2)
  })

  it('issues no backward fetch when the seek page has no previous page', async () => {
    let backwardFetches = 0
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.before) {
          backwardFetches += 1
        }
        if (variables.filter?.startLetter === 'A') {
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c-a', node: movieNode('4', 'Alright') }],
              hasPreviousPage: false,
            }),
          })
        }
        return HttpResponse.json({
          data: libraryResponse({ edges: [{ cursor: 'c1', node: movieNode('1', 'Everlight') }] }),
        })
      }),
    )

    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByText('Everlight')).toBeInTheDocument())

    await user.click(screen.getByText('Jump to A'))

    await waitFor(() => expect(screen.getByText('Alright')).toBeInTheDocument())
    expect(backwardFetches).toBe(0)
  })

  it('does not spuriously reopen backward pagination after a forward loadMore', async () => {
    let backwardFetches = 0
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.before) {
          backwardFetches += 1
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c-dup', node: movieNode('dup', 'Should Not Appear') }],
            }),
          })
        }
        if (variables.after) {
          // The fetched page's own pageInfo correctly says there IS something before *it*
          // (page 1) — that must not leak into the merged list's overall hasPreviousPage.
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c2', node: movieNode('2', 'Second Page') }],
              hasNextPage: false,
              hasPreviousPage: true,
              startCursor: 'c2',
            }),
          })
        }
        return HttpResponse.json({
          data: libraryResponse({
            edges: [{ cursor: 'c1', node: movieNode('1', 'Everlight') }],
            hasNextPage: true,
            hasPreviousPage: false,
          }),
        })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByTestId('hasNextPage')).toHaveTextContent('true'))
    expect(screen.getByTestId('hasPreviousPage')).toHaveTextContent('false')

    await user.click(screen.getByText('Load more'))

    await waitFor(() => expect(screen.getByText('Second Page')).toBeInTheDocument())
    expect(screen.getByTestId('hasPreviousPage')).toHaveTextContent('false')
    expect(backwardFetches).toBe(0)
  })

  it('shouldAskForTitlesOnceTheGridHasMeasuredItsColumnsWhenItOpens', async () => {
    const requested: LibraryPageQueryVariables[] = []
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        requested.push(variables)
        return HttpResponse.json({ data: libraryResponse({ edges: movieEdges(50) }) })
      }),
    )
    const { user } = renderWithProviders(<Harness initialColumns={null} />)
    expect(screen.getByTestId('loading')).toHaveTextContent('true')
    expect(requested).toEqual([])

    await user.click(screen.getByText('Measure five columns'))

    await screen.findByText('Title 049')
    expect(requested.map((variables) => variables.first)).toEqual([50])
  })

  it('shouldFinishTheLastRowWhenLoadingMoreAfterAPartialRow', async () => {
    const requested: LibraryPageQueryVariables[] = []
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        requested.push(variables)
        const edges = movieEdges(100).slice(variables.after ? 48 : 0, variables.after ? 100 : 48)
        return HttpResponse.json({
          data: libraryResponse({ edges, hasNextPage: !variables.after }),
        })
      }),
    )
    const { user } = renderWithProviders(<Harness initialColumns={5} />)
    await waitFor(() => expect(screen.getByTestId('hasNextPage')).toHaveTextContent('true'))

    await user.click(screen.getByText('Load more'))

    await screen.findByText('Title 099')
    expect(requested.map((variables) => variables.first)).toEqual([50, 52])
  })

  it('shouldLoadWholeRowsWhenLoadingTitlesBeforeTheLoadedOnes', async () => {
    const requested: LibraryPageQueryVariables[] = []
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        requested.push(variables)
        const edges = variables.before ? movieEdges(100).slice(0, 50) : movieEdges(100).slice(50)
        return HttpResponse.json({
          data: libraryResponse({ edges, hasPreviousPage: !variables.before }),
        })
      }),
    )
    const { user } = renderWithProviders(<Harness initialColumns={5} />)
    await waitFor(() => expect(screen.getByTestId('hasPreviousPage')).toHaveTextContent('true'))

    await user.click(screen.getByText('Load previous'))

    await screen.findByText('Title 000')
    expect(requested.map((variables) => variables.last ?? null)).toEqual([null, 50])
  })

  it('shouldFillTheLettersRowWhenLoadingTheTitlesBeforeIt', async () => {
    const requested: LibraryPageQueryVariables[] = []
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        requested.push(variables)
        const title = variables.before ? 'Middle' : 'Northern'
        return HttpResponse.json({
          data: libraryResponse({
            edges: [{ cursor: title, node: movieNode(title, title) }],
            hasPreviousPage: !variables.before,
            alphabetIndex: [
              { letter: 'A', count: 4 },
              { letter: 'M', count: 3 },
              { letter: 'N', count: 1 },
            ],
          }),
        })
      }),
    )

    renderWithProviders(<Harness initialFilter={{ startLetter: 'N' }} initialColumns={5} />)

    await screen.findByText('Middle')
    // Seven titles come before N, so its first title is the third in its row.
    expect(requested.map((variables) => variables.last ?? null)).toEqual([null, 52])
  })

  it('shouldPlaceTheFirstLoadedTitleByItsPositionInTheLibrary', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        const edges = variables.before
          ? [
              { cursor: 'l1', node: movieNode('l1', 'Lagoon') },
              { cursor: 'm1', node: movieNode('m1', 'Middle') },
            ]
          : [{ cursor: 'n1', node: movieNode('n1', 'Northern') }]
        return HttpResponse.json({
          data: libraryResponse({
            edges,
            hasPreviousPage: true,
            alphabetIndex: [
              { letter: 'A', count: 4 },
              { letter: 'M', count: 3 },
              { letter: 'N', count: 1 },
            ],
          }),
        })
      }),
    )

    renderWithProviders(<Harness initialFilter={{ startLetter: 'N' }} initialColumns={5} />)

    await screen.findByText('Lagoon')
    expect(screen.getByTestId('firstPosition')).toHaveTextContent('5')
  })

  it('shouldHoldALetterUntilTheTitlesBeforeItArriveWhenTheyAreStillLoading', async () => {
    let release!: () => void
    const behind = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>(
        'LibraryPage',
        async ({ variables }) => {
          if (variables.before) await behind
          const title = variables.before
            ? 'Middle'
            : variables.filter?.startLetter
              ? 'Northern'
              : 'Alpha'
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: title, node: movieNode(title, title) }],
              hasPreviousPage: title === 'Northern',
            }),
          })
        },
      ),
    )
    const { user } = renderWithProviders(<Harness />)
    await screen.findByText('Alpha', { selector: 'li' })

    await user.click(screen.getByText('Jump to N'))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Alpha'])
    expect(screen.getByTestId('landing')).toHaveTextContent('')
    release()
    await screen.findByText('Northern', { selector: 'li' })
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Middle',
      'Northern',
    ])
    expect(screen.getByTestId('landing')).toHaveTextContent('Northern')
  })

  it('resets the accumulated edges when the filter changes', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.filter?.watchStatus === 'UNWATCHED') {
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c-u', node: movieNode('5', 'Unwatched Title') }],
            }),
          })
        }
        if (variables.after) {
          return HttpResponse.json({
            data: libraryResponse({
              edges: [{ cursor: 'c2', node: movieNode('2', 'Second Page') }],
              hasNextPage: false,
            }),
          })
        }
        return HttpResponse.json({
          data: libraryResponse({
            edges: [{ cursor: 'c1', node: movieNode('1', 'Everlight') }],
            hasNextPage: true,
          }),
        })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByText('Everlight')).toBeInTheDocument())
    await user.click(screen.getByText('Load more'))
    await waitFor(() => expect(screen.getByText('Second Page')).toBeInTheDocument())

    await user.click(screen.getByText('Unwatched only'))

    await waitFor(() => expect(screen.getByText('Unwatched Title')).toBeInTheDocument())
    expect(screen.queryByText('Everlight')).not.toBeInTheDocument()
  })

  it('shouldUseTheServerCursorWhenAChangeBecomesTheFirstItemOfTheLetter', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        const earlier = Boolean(variables.before)
        return HttpResponse.json({
          data: libraryResponse({
            edges: [
              earlier
                ? { cursor: 'm', node: movieNode('m', 'Middle') }
                : { cursor: 'n', node: movieNode('n', 'Northern Line') },
            ],
            hasPreviousPage: !earlier,
          }),
        })
      }),
    )
    const socket = serveGraphqlSocket()
    renderWithProviders(
      <LibraryContentsProvider profileId="profile" pathname={`/library/${LIBRARY_ID}`}>
        <LiveHarness filter={{ watchStatus: 'IN_PROGRESS', startLetter: 'N' }} />
      </LibraryContentsProvider>,
    )
    await screen.findByText('Middle')
    await waitFor(() => expect(socket.isLive('LibraryItemUpdated')).toBe(true))

    socket.publish('LibraryItemUpdated', {
      data: {
        change: {
          __typename: 'LibraryItemChange',
          libraryId: LIBRARY_ID,
          itemId: 'nadir',
          kind: 'MOVIE',
          item: movieNode('nadir', 'Nadir'),
          edge: {
            __typename: 'MediaEdge',
            cursor: 'server-nadir',
            orderKey: 'Nadir',
            node: movieNode('nadir', 'Nadir'),
          },
        },
      },
    })

    await screen.findByText('Nadir')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Middle',
      'Nadir',
      'Northern Line',
    ])
    expect(screen.getByTestId('landing').textContent).toBe('server-nadir')
  })

  it('shouldShowATitleOnceWhenTheNextPageBringsBackOneAlreadyLoaded', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        const edges = variables.after
          ? [
              { cursor: 'c2', node: movieNode('2', 'Northern Line') },
              { cursor: 'c3', node: movieNode('3', 'Ocean') },
            ]
          : [
              { cursor: 'c1', node: movieNode('1', 'Everlight') },
              { cursor: 'c2', node: movieNode('2', 'Northern Line') },
            ]
        const response = libraryResponse({ edges, hasNextPage: !variables.after })
        // A title that no longer resolves stays a gap in the page.
        if (variables.after) response.library.items.edges!.push(null)
        return HttpResponse.json({ data: response })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByTestId('hasNextPage')).toHaveTextContent('true'))

    await user.click(screen.getByText('Load more'))

    await screen.findByText('Ocean')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Everlight',
      'Northern Line',
      'Ocean',
    ])
  })

  it('shouldUnloadTheTitlesFarBeforeTheViewAndLoadThemAgainWhenScrollingBack', async () => {
    const { requested } = serveLibraryOf(600)
    const { user } = renderWithProviders(<Harness />)
    await loadTitlesThrough(user, 'Title 527')

    await user.click(screen.getByText('View the last title'))

    await waitFor(() => expect(screen.queryByText('Title 286')).not.toBeInTheDocument())
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Title 287')
    expect(screen.getByTestId('hasPreviousPage')).toHaveTextContent('true')
    expect(screen.getByTestId('firstPosition')).toHaveTextContent('287')

    await user.click(screen.getByText('Load previous'))

    await screen.findByText('Title 239')
    expect(requested.at(-1)).toMatchObject({ before: 'c287', last: 48 })
    expect(screen.getByTestId('firstPosition')).toHaveTextContent('239')
  })

  it('shouldUnloadTheTitlesFarAfterTheViewAndLoadThemOnlyWhenScrolledTo', async () => {
    const { requested, served } = serveLibraryOf(600)
    const { user } = renderWithProviders(<Harness />)
    await loadTitlesThrough(user, 'Title 527')

    await user.click(screen.getByText('View the first title'))

    await waitFor(() => expect(screen.queryByText('Title 241')).not.toBeInTheDocument())
    expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent('Title 240')
    expect(screen.getByTestId('hasNextPage')).toHaveTextContent('true')
    const unloadedAt = requested.length

    await user.click(screen.getByText('Load more'))

    await screen.findByText('Title 288')
    await waitFor(() => expect(served.count).toBe(requested.length))
    expect(requested.slice(unloadedAt)).toEqual([
      expect.objectContaining({ after: 'c240', first: 48 }),
    ])
    expect(screen.queryByText('Title 289')).not.toBeInTheDocument()
  })

  it('shouldUnloadWholeRowsSoTheTitlesInViewKeepTheirColumns', async () => {
    serveLibraryOf(600)
    const { user } = renderWithProviders(<Harness initialColumns={5} />)
    await loadTitlesThrough(user, 'Title 549')

    await user.click(screen.getByText('View the last title'))

    await waitFor(() => expect(screen.getByTestId('firstPosition')).toHaveTextContent('305'))
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Title 305')
  })

  it('shouldKeepEveryTitleWhileNoneIsFarFromTheView', async () => {
    serveLibraryOf(600)
    const { user } = renderWithProviders(<Harness />)
    await loadTitlesThrough(user, 'Title 479')

    await user.click(screen.getByText('View the 251st title'))

    expect(screen.getAllByRole('listitem')).toHaveLength(480)
    expect(screen.getByTestId('hasPreviousPage')).toHaveTextContent('false')
  })

  it('shouldKeepLiveAdditionsOutOfUnloadedTitlesWhileCountingThem', async () => {
    serveLibraryOf(600)
    const socket = serveGraphqlSocket()
    const { user } = renderWithProviders(
      <LibraryContentsProvider profileId="profile" pathname={`/library/${LIBRARY_ID}`}>
        <Harness />
      </LibraryContentsProvider>,
    )
    await loadTitlesThrough(user, 'Title 527')
    await user.click(screen.getByText('View the first title'))
    await waitFor(() => expect(screen.queryByText('Title 241')).not.toBeInTheDocument())
    await waitFor(() => expect(socket.isLive('LibraryItemAdded')).toBe(true))

    socket.publish('LibraryItemAdded', liveAddition('late', 'Title 300 Sequel'))
    socket.publish('LibraryItemAdded', liveAddition('near', 'Title 100 Sequel'))
    socket.publish('LibraryCountsChanged', {
      data: {
        change: {
          __typename: 'Library',
          id: LIBRARY_ID,
          itemCount: 602,
          alphabetIndex: [{ letter: 'T', count: 602 }],
        },
      },
    })

    await screen.findByText('Title 100 Sequel')
    expect(screen.queryByText('Title 300 Sequel')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('counts')).toHaveTextContent('602 T:602'))
  })

  it('shouldReleaseTheTitlesItUnloadsFromTheCache', async () => {
    serveLibraryOf(600)
    const { user } = renderWithProviders(<Harness />)
    await loadTitlesThrough(user, 'Title 527')

    await user.click(screen.getByText('View the first title'))
    await waitFor(() => expect(screen.queryByText('Title 241')).not.toBeInTheDocument())
    await user.click(screen.getByText('Count cached titles'))

    expect(screen.getByTestId('cachedTitles')).toHaveTextContent('241')
  })
})
