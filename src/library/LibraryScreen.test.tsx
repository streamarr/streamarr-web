import { ObservableQuery } from '@apollo/client'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse, type GraphQLQuery } from 'msw'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { LibraryPageQuery, LibraryPageQueryVariables } from '../graphql/generated/graphql'
import {
  intersectionObserverInstances,
  JSDOM_GRID_HEIGHT,
  JSDOM_ROW_HEIGHT,
  resizeObserverInstances,
} from '../../vitest.setup'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { LibraryScreen, type LibrarySearch } from './LibraryScreen'

const LIBRARY_ID = '11111111-1111-1111-1111-111111111111'

function movieNode(
  overrides: Partial<{
    id: string
    title: string
    watchStatus: string
    percentComplete: number | null
  }> = {},
) {
  return {
    __typename: 'Movie' as const,
    id: overrides.id ?? '1',
    title: overrides.title ?? 'Everlight',
    titleSort: overrides.title ?? 'Everlight',
    releaseDate: '2024-01-01',
    runtime: 100,
    watchStatus: (overrides.watchStatus as 'UNWATCHED' | 'IN_PROGRESS' | 'WATCHED') ?? 'UNWATCHED',
    watchProgress:
      overrides.percentComplete != null ? { percentComplete: overrides.percentComplete } : null,
    images: [],
  }
}

function seriesNode(overrides: Partial<{ id: string; title: string }> = {}) {
  return {
    __typename: 'Series' as const,
    id: overrides.id ?? 's-1',
    title: overrides.title ?? 'Northern Line',
    titleSort: overrides.title ?? 'Northern Line',
    firstAirDate: '2017-07-21',
    seasons: [{ id: 'season-1' }],
    watchStatus: 'UNWATCHED' as const,
    watchProgress: null,
    images: [],
  }
}

function libraryData(
  overrides: {
    edges?: { cursor: string; node: ReturnType<typeof movieNode> | ReturnType<typeof seriesNode> }[]
    hasNextPage?: boolean
    scanCompletedOn?: string | null
  } = {},
): LibraryPageQuery & { library: { __typename: 'Library' } } {
  return {
    library: {
      __typename: 'Library',
      id: LIBRARY_ID,
      name: 'Movies',
      status: 'HEALTHY',
      scanCompletedOn: overrides.scanCompletedOn ?? '2026-08-28T11:46:00Z',
      alphabetIndex: [
        { letter: 'A', count: 1 },
        { letter: 'E', count: 1 },
        { letter: 'N', count: 1 },
      ],
      items: {
        edges: overrides.edges ?? [{ cursor: 'c1', node: movieNode() }],
        pageInfo: {
          hasNextPage: overrides.hasNextPage ?? false,
          hasPreviousPage: false,
          startCursor: overrides.edges ? (overrides.edges[0]?.cursor ?? null) : 'c1',
          endCursor: overrides.edges ? (overrides.edges.at(-1)?.cursor ?? null) : 'c1',
        },
      },
    },
  }
}

// One title per row in jsdom, so a row index is a title index.
function titledEdges(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const id = String(index).padStart(2, '0')
    return { cursor: `c${id}`, node: movieNode({ id, title: `Title ${id}` }) }
  })
}

// jsdom lays out no grid tracks; the rows report this many columns instead, until changed.
function rowColumns(initial: number) {
  let tracks = initial
  const computedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) =>
    element.hasAttribute('data-index')
      ? ({
          gridTemplateColumns: Array.from({ length: tracks }, () => '100px').join(' '),
          rowGap: '',
        } as unknown as CSSStyleDeclaration)
      : computedStyle(element, pseudo),
  )
  return {
    set(next: number) {
      tracks = next
    },
  }
}

function twoColumnRows() {
  rowColumns(2)
}

const DEFAULT_SEARCH: LibrarySearch = { by: 'ADDED', direction: 'DESC' }

function Harness({
  initialSearch = DEFAULT_SEARCH,
  onSearchChange,
}: {
  initialSearch?: LibrarySearch
  onSearchChange?: (search: LibrarySearch) => void
}) {
  const [search, setSearch] = useState(initialSearch)
  return (
    <LibraryScreen
      libraryId={LIBRARY_ID}
      search={search}
      onSearchChange={(next) => {
        onSearchChange?.(next)
        setSearch(next)
      }}
    />
  )
}

describe('LibraryScreen', () => {
  it.each([
    { by: 'ADDED', direction: 'DESC', letter: 'N' },
    { by: 'TITLE', direction: 'ASC', letter: 'N', watchStatus: 'UNWATCHED' },
  ] satisfies LibrarySearch[])(
    'ignores a hidden letter constraint in initial search state: %j',
    async (initialSearch) => {
      server.use(
        graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) =>
          HttpResponse.json({
            data: libraryData({
              edges: variables.filter?.startLetter
                ? []
                : [{ cursor: 'a', node: movieNode({ title: 'Available Alpha' }) }],
            }),
          }),
        ),
      )
      renderWithProviders(<Harness initialSearch={initialSearch} />)
      await screen.findByText('Available Alpha')
      expect(screen.queryByRole('navigation', { name: 'Jump to letter' })).not.toBeInTheDocument()
    },
  )

  it('shows matching earlier titles when a watch filter is applied after a letter jump', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) =>
        HttpResponse.json({
          data: libraryData({
            edges: variables.filter?.watchStatus
              ? variables.filter.startLetter
                ? []
                : [{ cursor: 'a', node: movieNode({ id: 'a', title: 'Alpha Unwatched' }) }]
              : [{ cursor: 'n', node: movieNode({ id: 'n', title: 'Northern' }) }],
          }),
        }),
      ),
    )
    const { user } = renderWithProviders(
      <Harness initialSearch={{ by: 'TITLE', direction: 'ASC', letter: 'N' }} />,
    )
    await screen.findByText('Northern')
    await user.click(screen.getByRole('button', { name: 'Unwatched' }))
    await screen.findByText('Alpha Unwatched')
    expect(screen.queryByText('No items match this filter.')).not.toBeInTheDocument()
  })

  it('shows an error state when the query fails', async () => {
    server.use(
      graphql.query('LibraryPage', () => HttpResponse.json({ errors: [{ message: 'boom' }] })),
    )
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  it('renders the header with item count and relative scan time', async () => {
    server.use(graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryData() })))
    renderWithProviders(<Harness />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument())
    expect(screen.getByText(/3 items/)).toBeInTheDocument()
    expect(screen.getByText(/last scan/)).toBeInTheDocument()
  })

  it('renders a watched badge for a WATCHED item', async () => {
    server.use(
      graphql.query('LibraryPage', () =>
        HttpResponse.json({
          data: libraryData({
            edges: [{ cursor: 'c1', node: movieNode({ watchStatus: 'WATCHED' }) }],
          }),
        }),
      ),
    )
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByLabelText('Watched')).toBeInTheDocument())
  })

  it('shows an empty state when no items match', async () => {
    server.use(
      graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryData({ edges: [] }) })),
    )
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByText('No items match this filter.')).toBeInTheDocument())
  })

  it('hides the alphabet rail under a watch-status filter, since alphabetIndex has no filter argument', async () => {
    server.use(
      graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryData({ edges: [] }) })),
    )
    renderWithProviders(
      <Harness initialSearch={{ by: 'TITLE', direction: 'ASC', watchStatus: 'IN_PROGRESS' }} />,
    )
    await waitFor(() => expect(screen.getByText('No items match this filter.')).toBeInTheDocument())
    expect(screen.queryByRole('navigation', { name: 'Jump to letter' })).not.toBeInTheDocument()
  })

  it('shows the alphabet rail again once the watch-status filter is cleared', async () => {
    server.use(graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryData() })))
    renderWithProviders(<Harness initialSearch={{ by: 'TITLE', direction: 'ASC' }} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument())
    expect(screen.getByRole('navigation', { name: 'Jump to letter' })).toBeInTheDocument()
  })

  it('links each movie card to its detail page', async () => {
    server.use(
      graphql.query('LibraryPage', () =>
        HttpResponse.json({
          data: libraryData({
            edges: [{ cursor: 'c1', node: movieNode({ id: 'm-1', title: 'Alright' }) }],
          }),
        }),
      ),
    )
    renderWithProviders(<Harness />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Alright/ })).toHaveAttribute('href', '/movie/m-1'),
    )
  })

  it('links each series card to its detail page', async () => {
    server.use(
      graphql.query('LibraryPage', () =>
        HttpResponse.json({
          data: libraryData({
            edges: [{ cursor: 'c1', node: seriesNode({ id: 's-9', title: 'Northern Line' }) }],
          }),
        }),
      ),
    )
    renderWithProviders(<Harness />)
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Northern Line/ })).toHaveAttribute(
        'href',
        '/series/s-9',
      ),
    )
  })

  it('hides the alphabet rail when sorted by anything other than TITLE, since a tap would silently shrink the library to one letter (ADR 0023)', async () => {
    server.use(graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryData() })))
    renderWithProviders(<Harness initialSearch={{ by: 'ADDED', direction: 'DESC' }} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument())
    expect(screen.queryByRole('navigation', { name: 'Jump to letter' })).not.toBeInTheDocument()
  })

  it('reports a filter chip tap through onSearchChange', async () => {
    server.use(graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryData() })))
    const onSearchChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<Harness onSearchChange={onSearchChange} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Unwatched' }))

    expect(onSearchChange).toHaveBeenCalledWith({ ...DEFAULT_SEARCH, watchStatus: 'UNWATCHED' })
  })

  it('forces TITLE/ASC in a single onSearchChange call when a rail letter is tapped under a different sort', async () => {
    server.use(graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryData() })))
    const onSearchChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <Harness initialSearch={{ by: 'TITLE', direction: 'ASC' }} onSearchChange={onSearchChange} />,
    )
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument())

    await user.click(screen.getByText('N'))

    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith({ by: 'TITLE', direction: 'ASC', letter: 'N' })
  })

  it('clears an active letter when sort changes away from TITLE', async () => {
    server.use(graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryData() })))
    const onSearchChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <Harness
        initialSearch={{ by: 'TITLE', direction: 'ASC', letter: 'N' }}
        onSearchChange={onSearchChange}
      />,
    )
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Sort:/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Recently added' }))

    expect(onSearchChange).toHaveBeenCalledWith({
      by: 'ADDED',
      direction: 'DESC',
      letter: undefined,
    })
  })

  it('updates the rail highlight from scroll position without issuing a new query', async () => {
    let queryCount = 0
    server.use(
      graphql.query('LibraryPage', () => {
        queryCount += 1
        return HttpResponse.json({
          data: libraryData({
            edges: [
              { cursor: 'c1', node: movieNode({ id: '1', title: 'Alright' }) },
              { cursor: 'c2', node: movieNode({ id: '2', title: 'Northern Line' }) },
            ],
          }),
        })
      }),
    )
    renderWithProviders(<Harness initialSearch={{ by: 'TITLE', direction: 'ASC' }} />)
    await waitFor(() => expect(screen.getByText('Northern Line')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('A')).toHaveAttribute('aria-pressed', 'true'))
    const queriesAfterLoad = queryCount

    // The second row tops the grid once the first has scrolled away.
    const grid = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    grid.scrollTop = JSDOM_ROW_HEIGHT
    fireEvent.scroll(grid)

    await waitFor(() => expect(screen.getByText('N')).toHaveAttribute('aria-pressed', 'true'))
    expect(queryCount).toBe(queriesAfterLoad)
  })

  it('does not apply an abandoned backward page measurement after changing the watch filter', async () => {
    const fetchMore = vi.spyOn(ObservableQuery.prototype, 'fetchMore')
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    let backwardRequested = false
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>(
        'LibraryPage',
        async ({ variables }) => {
          if (variables.before) {
            backwardRequested = true
            await pending
            return HttpResponse.json({
              data: libraryData({
                edges: [{ cursor: 'old', node: movieNode({ id: 'old', title: 'Old backfill' }) }],
              }),
            })
          }
          if (variables.filter?.watchStatus) {
            return HttpResponse.json({
              data: libraryData({
                edges: [
                  { cursor: 'a', node: movieNode({ id: 'a', title: 'Available Alpha' }) },
                  { cursor: 'z', node: movieNode({ id: 'z', title: 'Available Zeta' }) },
                ],
              }),
            })
          }
          const data = libraryData({
            edges: [{ cursor: 'n', node: movieNode({ id: 'n', title: 'Northern' }) }],
          })
          data.library.items.pageInfo.hasPreviousPage = true
          return HttpResponse.json({ data })
        },
      ),
    )
    const { user } = renderWithProviders(
      <Harness initialSearch={{ by: 'TITLE', direction: 'ASC', letter: 'N' }} />,
    )
    await screen.findByText('Northern')
    const oldGrid = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    const sentinel = oldGrid.querySelector('[data-edge="start"]')!
    const observer = intersectionObserverInstances.find((instance) =>
      instance.observe.mock.calls.some((call) => call[0] === sentinel),
    )!
    act(() =>
      observer.callback(
        [{ target: sentinel, isIntersecting: true } as IntersectionObserverEntry],
        observer,
      ),
    )
    await waitFor(() => expect(backwardRequested).toBe(true))
    const backwardCompletion = fetchMore.mock.results[0].value as Promise<unknown>

    await user.click(screen.getByRole('button', { name: 'Unwatched' }))
    await screen.findByText('Available Alpha')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await act(async () => {
        release()
        await backwardCompletion
        // Flush Apollo's deferred query notifications before checking the rendered grid.
        await vi.runOnlyPendingTimersAsync()
      })
    } finally {
      vi.useRealTimers()
    }

    const filteredGrid = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    expect(screen.queryByText('Old backfill')).not.toBeInTheDocument()
    expect(filteredGrid.scrollTop).toBe(0)
  })

  it('compensates scrollTop when the top sentinel loads more, so it leaves the intersecting zone and the view does not jump', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.before) {
          return HttpResponse.json({
            data: libraryData({
              edges: [{ cursor: 'c0', node: movieNode({ id: '0', title: 'Aardvark' }) }],
              hasNextPage: false,
            }),
          })
        }
        return HttpResponse.json({
          data: {
            ...libraryData(),
            library: {
              ...libraryData().library,
              items: {
                edges: [{ cursor: 'c1', node: movieNode({ id: '1', title: 'Beta' }) }],
                pageInfo: {
                  hasNextPage: false,
                  hasPreviousPage: true,
                  startCursor: 'c1',
                  endCursor: 'c1',
                },
              },
            },
          },
        })
      }),
    )
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument())

    const grid = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    const sentinel = grid.querySelector('[data-edge="start"]') as HTMLDivElement
    grid.scrollTop = 50

    const observer = intersectionObserverInstances.find((instance) =>
      instance.observe.mock.calls.some((call) => call[0] === sentinel),
    )!
    observer.callback(
      [{ target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry],
      observer,
    )

    await waitFor(() => expect(screen.getByText('Aardvark')).toBeInTheDocument())
    // scrollTop should track the prepended row exactly.
    await waitFor(() => expect(grid.scrollTop).toBe(50 + JSDOM_ROW_HEIGHT))
  })

  it('highlights the pressed letter when its first title shares the top row with the letter before it', async () => {
    // Two columns, so the backfilled Ozark and the landing Paddington share the top row.
    twoColumnRows()
    const withRail = (edges: { cursor: string; node: ReturnType<typeof movieNode> }[]) => {
      const data = libraryData({ edges })
      data.library.alphabetIndex = [
        { letter: 'A', count: 1 },
        { letter: 'O', count: 1 },
        { letter: 'P', count: 1 },
      ]
      return data
    }
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.before) {
          return HttpResponse.json({
            data: withRail([{ cursor: 'o', node: movieNode({ id: 'o', title: 'Ozark' }) }]),
          })
        }
        if (variables.filter?.startLetter === 'P') {
          const data = withRail([
            { cursor: 'p', node: movieNode({ id: 'p', title: 'Paddington' }) },
          ])
          data.library.items.pageInfo.hasPreviousPage = true
          return HttpResponse.json({ data })
        }
        return HttpResponse.json({
          data: withRail([{ cursor: 'a', node: movieNode({ id: 'a', title: 'Alright' }) }]),
        })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Harness initialSearch={{ by: 'TITLE', direction: 'ASC' }} />)
    await screen.findByText('Alright')

    await user.click(screen.getByRole('button', { name: 'P' }))

    await screen.findByText('Ozark')
    expect(screen.getByText('Paddington')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'P' })).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getByRole('button', { name: 'O' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('lands the grid on the jump target and keeps it there when the continuity page is prepended above', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.before) {
          return HttpResponse.json({
            data: libraryData({
              edges: [{ cursor: 'c-alright', node: movieNode({ id: 'a', title: 'Alright' }) }],
              hasNextPage: false,
            }),
          })
        }
        if (variables.filter?.startLetter === 'N') {
          return HttpResponse.json({
            data: {
              library: {
                ...libraryData().library,
                items: {
                  edges: [
                    { cursor: 'c-northern', node: movieNode({ id: 'n', title: 'Northern Line' }) },
                  ],
                  pageInfo: {
                    hasNextPage: false,
                    hasPreviousPage: true,
                    startCursor: 'c-northern',
                    endCursor: 'c-northern',
                  },
                },
              },
            },
          })
        }
        return HttpResponse.json({ data: libraryData() })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<Harness initialSearch={{ by: 'TITLE', direction: 'ASC' }} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument())

    await user.click(screen.getByText('N'))

    await waitFor(() => expect(screen.getByText('Alright')).toBeInTheDocument())
    expect(screen.getByText('Northern Line')).toBeInTheDocument()
    // The prepended Alright row sits above Northern Line, which stays at the top of the grid.
    const grid = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    await waitFor(() => expect(grid.scrollTop).toBe(JSDOM_ROW_HEIGHT))
  })

  it('keeps the focused card mounted, and focused, when its row scrolls out of the rendered range', async () => {
    server.use(
      graphql.query('LibraryPage', () =>
        HttpResponse.json({ data: libraryData({ edges: titledEdges(12) }) }),
      ),
    )
    renderWithProviders(<Harness />)
    const first = await screen.findByRole('link', { name: /Title 00/ })
    act(() => first.focus())
    expect(first).toHaveFocus()

    // Nine rows down, rows 0 to 6 are outside the viewport and its overscan.
    const grid = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    grid.scrollTop = 9 * JSDOM_ROW_HEIGHT
    fireEvent.scroll(grid)

    await screen.findByRole('link', { name: /Title 09/ })
    expect(screen.queryByRole('link', { name: /Title 01/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Title 00/ })).toBe(first)
    expect(first).toHaveFocus()
  })

  it('offers one tab stop into the grid, moves between cards with the arrow keys, and leaves it on Tab', async () => {
    twoColumnRows()
    server.use(
      graphql.query('LibraryPage', () =>
        HttpResponse.json({ data: libraryData({ edges: titledEdges(4) }) }),
      ),
    )
    const { user } = renderWithProviders(
      <Harness initialSearch={{ by: 'TITLE', direction: 'ASC' }} />,
    )
    await screen.findByRole('link', { name: /Title 03/ })
    // Two columns: Title 00 and 01 share the first row, 02 and 03 the second.
    const cards = screen.getAllByRole('link', { name: /Title/ })
    expect(cards.map((card) => card.tabIndex)).toEqual([0, -1, -1, -1])

    act(() => cards[0].focus())
    await user.keyboard('{ArrowRight}')
    expect(cards[1]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(cards[3]).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(cards[2]).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(cards[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(cards[1]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(cards[0]).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    await user.tab()
    expect(screen.getByRole('button', { name: 'A' })).toHaveFocus()
    // The grid remembers its place: Shift+Tab returns to the card that had focus.
    await user.tab({ shift: true })
    expect(cards[1]).toHaveFocus()
  })

  it('exposes the rows as a grid that announces each rendered row among all the loaded rows', async () => {
    twoColumnRows()
    server.use(
      graphql.query('LibraryPage', () =>
        HttpResponse.json({ data: libraryData({ edges: titledEdges(24) }) }),
      ),
    )
    renderWithProviders(<Harness />)
    await screen.findByRole('link', { name: /Title 00/ })
    const grid = screen.getByRole('grid', { name: 'Items' })
    expect(grid).toHaveAttribute('aria-rowcount', '12')
    const firstRow = within(grid).getAllByRole('row')[0]
    expect(firstRow).toHaveAttribute('aria-rowindex', '1')
    expect(within(firstRow).getAllByRole('gridcell')).toHaveLength(2)

    const scroller = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    scroller.scrollTop = 9 * JSDOM_ROW_HEIGHT
    fireEvent.scroll(scroller)

    const nineteenth = await screen.findByRole('link', { name: /Title 18/ })
    expect(nineteenth.closest('[role="row"]')).toHaveAttribute('aria-rowindex', '10')
  })

  it('moves focus to the landing card after a letter jump made from the keyboard, and not after a pointer jump', async () => {
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) =>
        HttpResponse.json({
          data: libraryData({
            edges:
              variables.filter?.startLetter === 'N'
                ? [{ cursor: 'n', node: movieNode({ id: 'n', title: 'Northern Line' }) }]
                : [{ cursor: 'a', node: movieNode({ id: 'a', title: 'Alright' }) }],
          }),
        }),
      ),
    )
    const { user } = renderWithProviders(
      <Harness initialSearch={{ by: 'TITLE', direction: 'ASC' }} />,
    )
    await screen.findByRole('link', { name: /Alright/ })

    act(() => screen.getByRole('button', { name: 'N' }).focus())
    await user.keyboard('{Enter}')

    const landing = await screen.findByRole('link', { name: /Northern Line/ })
    await waitFor(() => expect(landing).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'A' }))

    await screen.findByRole('link', { name: /Alright/ })
    expect(screen.getByRole('button', { name: 'A' })).toHaveFocus()
  })

  it('re-lays the rows for a new width before the browser paints the frame that resized the grid', async () => {
    const columns = rowColumns(2)
    server.use(
      graphql.query('LibraryPage', () =>
        HttpResponse.json({ data: libraryData({ edges: titledEdges(4) }) }),
      ),
    )
    renderWithProviders(<Harness />)
    await screen.findByRole('link', { name: /Title 03/ })
    const cellsInFirstRow = () =>
      within(screen.getAllByRole('row')[0]).getAllByRole('gridcell').length
    expect(cellsInFirstRow()).toBe(2)

    // The grid narrows to one column; every observer of it hears after layout, before paint.
    columns.set(1)
    const grid = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    const observers = resizeObserverInstances.filter((instance) =>
      instance.observe.mock.calls.some((call) => call[0] === grid),
    )
    expect(observers).not.toHaveLength(0)
    const resized = {
      target: grid,
      borderBoxSize: [{ inlineSize: 400, blockSize: JSDOM_GRID_HEIGHT }],
    } as unknown as ResizeObserverEntry
    act(() => {
      for (const observer of observers) {
        observer.callback([resized], observer)
      }
      // Before React flushes anything deferred: the rows already hold one card each.
      expect(cellsInFirstRow()).toBe(1)
    })
    expect(screen.getAllByRole('row')).toHaveLength(4)
  })

  it('keeps focus on the same card when a new width re-lays the rows around it', async () => {
    const columns = rowColumns(2)
    server.use(
      graphql.query('LibraryPage', () =>
        HttpResponse.json({ data: libraryData({ edges: titledEdges(4) }) }),
      ),
    )
    renderWithProviders(<Harness />)
    // Title 01 ends the first row now and will head a row of its own, keyed by its cursor.
    const card = await screen.findByRole('link', { name: /Title 01/ })
    act(() => card.focus())
    expect(card).toHaveFocus()

    columns.set(1)
    const grid = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    const resized = {
      target: grid,
      borderBoxSize: [{ inlineSize: 400, blockSize: JSDOM_GRID_HEIGHT }],
    } as unknown as ResizeObserverEntry
    act(() => {
      for (const observer of resizeObserverInstances.filter((instance) =>
        instance.observe.mock.calls.some((call) => call[0] === grid),
      )) {
        observer.callback([resized], observer)
      }
    })

    // The card is in a new element under a new row; focus followed it.
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(screen.getByRole('link', { name: /Title 01/ })).toHaveFocus()
  })

  it('keeps focus on the landing card when the page before it re-flows the rows', async () => {
    twoColumnRows()
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.before) {
          return HttpResponse.json({
            data: libraryData({
              edges: [{ cursor: 'm', node: movieNode({ id: 'm', title: 'Mountain' }) }],
            }),
          })
        }
        if (variables.filter?.startLetter === 'N') {
          const data = libraryData({
            edges: [{ cursor: 'n', node: movieNode({ id: 'n', title: 'Northern Line' }) }],
          })
          data.library.items.pageInfo.hasPreviousPage = true
          return HttpResponse.json({ data })
        }
        return HttpResponse.json({
          data: libraryData({
            edges: [{ cursor: 'a', node: movieNode({ id: 'a', title: 'Alright' }) }],
          }),
        })
      }),
    )
    const { user } = renderWithProviders(
      <Harness initialSearch={{ by: 'TITLE', direction: 'ASC' }} />,
    )
    await screen.findByText('Alright')

    act(() => screen.getByRole('button', { name: 'N' }).focus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('link', { name: /Northern Line/ })).toHaveFocus())

    // Mountain lands in front of Northern Line on the same two-column row.
    await screen.findByText('Mountain')
    expect(screen.getByRole('link', { name: /Northern Line/ })).toHaveFocus()
  })
})
