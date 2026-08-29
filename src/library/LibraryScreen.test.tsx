import { ObservableQuery } from '@apollo/client'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { LibraryPageQuery } from '../graphql/generated/graphql'
import { intersectionObserverInstances } from '../../vitest.setup'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { LibraryScreen, type LibrarySearch } from './LibraryScreen'

const LIBRARY_ID = '11111111-1111-1111-1111-111111111111'

function movieNode(overrides: Partial<{ id: string; title: string; watchStatus: string; percentComplete: number | null }> = {}) {
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

function libraryData(overrides: {
  edges?: { cursor: string; node: ReturnType<typeof movieNode> }[]
  hasNextPage?: boolean
  scanCompletedOn?: string | null
} = {}): LibraryPageQuery & { library: { __typename: 'Library' } } {
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
          startCursor: overrides.edges ? overrides.edges[0]?.cursor ?? null : 'c1',
          endCursor: overrides.edges ? overrides.edges.at(-1)?.cursor ?? null : 'c1',
        },
      },
    },
  }
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
  ] satisfies LibrarySearch[])('ignores a hidden letter constraint in initial search state: %j', async (initialSearch) => {
    server.use(graphql.query('LibraryPage', ({ variables }) => HttpResponse.json({ data: libraryData({
      edges: variables.filter?.startLetter ? [] : [{ cursor: 'a', node: movieNode({ title: 'Available Alpha' }) }],
    }) })))
    renderWithProviders(<Harness initialSearch={initialSearch} />)
    await screen.findByText('Available Alpha')
    expect(screen.queryByRole('navigation', { name: 'Jump to letter' })).not.toBeInTheDocument()
  })

  it('shows matching earlier titles when a watch filter is applied after a letter jump', async () => {
    server.use(graphql.query('LibraryPage', ({ variables }) => HttpResponse.json({ data: libraryData({
      edges: variables.filter?.watchStatus
        ? variables.filter.startLetter ? [] : [{ cursor: 'a', node: movieNode({ id: 'a', title: 'Alpha Unwatched' }) }]
        : [{ cursor: 'n', node: movieNode({ id: 'n', title: 'Northern' }) }],
    }) })))
    const { user } = renderWithProviders(<Harness initialSearch={{ by: 'TITLE', direction: 'ASC', letter: 'N' }} />)
    await screen.findByText('Northern')
    await user.click(screen.getByRole('button', { name: 'Unwatched' }))
    await screen.findByText('Alpha Unwatched')
    expect(screen.queryByText('No items match this filter.')).not.toBeInTheDocument()
  })

  it('shows an error state when the query fails', async () => {
    server.use(graphql.query('LibraryPage', () => HttpResponse.json({ errors: [{ message: 'boom' }] })))
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
          data: libraryData({ edges: [{ cursor: 'c1', node: movieNode({ watchStatus: 'WATCHED' }) }] }),
        }),
      ),
    )
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByLabelText('Watched')).toBeInTheDocument())
  })

  it('shows an empty state when no items match', async () => {
    server.use(graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryData({ edges: [] }) })))
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByText('No items match this filter.')).toBeInTheDocument())
  })

  it('hides the alphabet rail under a watch-status filter, since alphabetIndex has no filter argument', async () => {
    server.use(graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryData({ edges: [] }) })))
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
        HttpResponse.json({ data: libraryData({ edges: [{ cursor: 'c1', node: movieNode({ id: 'm-1', title: 'Alright' }) }] }) }),
      ),
    )
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByRole('link', { name: /Alright/ })).toHaveAttribute('href', '/movie/m-1'))
  })

  it('hides the alphabet rail when sorted by anything other than TITLE, since a tap would silently shrink the library to one letter (ADR 0018)', async () => {
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
    renderWithProviders(<Harness initialSearch={{ by: 'TITLE', direction: 'ASC' }} onSearchChange={onSearchChange} />)
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
      <Harness initialSearch={{ by: 'TITLE', direction: 'ASC', letter: 'N' }} onSearchChange={onSearchChange} />,
    )
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Sort:/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Recently added' }))

    expect(onSearchChange).toHaveBeenCalledWith({ by: 'ADDED', direction: 'DESC', letter: undefined })
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
    const queriesAfterLoad = queryCount

    const observer = intersectionObserverInstances.find((instance) =>
      instance.observe.mock.calls.some((call) => (call[0] as Element).textContent?.includes('Northern Line')),
    )!
    const target = observer.observe.mock.calls.find((call) =>
      (call[0] as Element).textContent?.includes('Northern Line'),
    )![0] as Element

    observer.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], observer)

    await waitFor(() => expect(screen.getByText('N')).toHaveAttribute('aria-pressed', 'true'))
    expect(queryCount).toBe(queriesAfterLoad)
  })

  it('does not apply an abandoned backward page measurement after changing the watch filter', async () => {
    const fetchMore = vi.spyOn(ObservableQuery.prototype, 'fetchMore')
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    let backwardRequested = false
    server.use(graphql.query('LibraryPage', async ({ variables }) => {
      if (variables.before) {
        backwardRequested = true
        await pending
        return HttpResponse.json({ data: libraryData({
          edges: [{ cursor: 'old', node: movieNode({ id: 'old', title: 'Old backfill' }) }],
        }) })
      }
      if (variables.filter?.watchStatus) {
        return HttpResponse.json({ data: libraryData({ edges: [
          { cursor: 'a', node: movieNode({ id: 'a', title: 'Available Alpha' }) },
          { cursor: 'z', node: movieNode({ id: 'z', title: 'Available Zeta' }) },
        ] }) })
      }
      const data = libraryData({
        edges: [{ cursor: 'n', node: movieNode({ id: 'n', title: 'Northern' }) }],
      })
      data.library.items.pageInfo.hasPreviousPage = true
      return HttpResponse.json({ data })
    }))
    // jsdom has no layout: model the new result as taller than the old measured grid.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.textContent?.includes('Available Alpha') ? 700 : 300
    })
    const { user } = renderWithProviders(<Harness initialSearch={{ by: 'TITLE', direction: 'ASC', letter: 'N' }} />)
    await screen.findByText('Northern')
    const oldGrid = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    const sentinel = oldGrid.firstElementChild!
    const observer = intersectionObserverInstances.find((instance) =>
      instance.observe.mock.calls.some((call) => call[0] === sentinel),
    )!
    act(() => observer.callback([{ target: sentinel, isIntersecting: true } as IntersectionObserverEntry], observer))
    await waitFor(() => expect(backwardRequested).toBe(true))
    const backwardCompletion = fetchMore.mock.results[0].value

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
      graphql.query('LibraryPage', ({ variables }) => {
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
                pageInfo: { hasNextPage: false, hasPreviousPage: true, startCursor: 'c1', endCursor: 'c1' },
              },
            },
          },
        })
      }),
    )
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument())

    const grid = document.querySelector('[class*="_grid_"]') as HTMLDivElement
    const sentinel = grid.firstElementChild as HTMLDivElement
    // Tied to real DOM state so it reads 300 before the fetch resolves, 700 once rendered.
    Object.defineProperty(grid, 'scrollHeight', {
      configurable: true,
      get: () => (document.body.textContent?.includes('Aardvark') ? 700 : 300),
    })
    grid.scrollTop = 50

    const observer = intersectionObserverInstances.find((instance) =>
      instance.observe.mock.calls.some((call) => call[0] === sentinel),
    )!
    observer.callback([{ target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry], observer)

    await waitFor(() => expect(screen.getByText('Aardvark')).toBeInTheDocument())
    // scrollTop should track the 400px of growth exactly.
    await waitFor(() => expect(grid.scrollTop).toBe(450))
  })

  it('scrolls the actual jump target into view, not the backward-continuity items prepended above it', async () => {
    const scrollIntoView = vi.fn()
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(scrollIntoView)
    server.use(
      graphql.query('LibraryPage', ({ variables }) => {
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
                  edges: [{ cursor: 'c-northern', node: movieNode({ id: 'n', title: 'Northern Line' }) }],
                  pageInfo: { hasNextPage: false, hasPreviousPage: true, startCursor: 'c-northern', endCursor: 'c-northern' },
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
    // The alphabet button is also revealed within its scrollable rail.
    const scrolledText = scrollIntoView.mock.instances.map((element) => (element as Element).textContent)
    expect(scrolledText).toContainEqual(expect.stringContaining('Northern Line'))
    expect(scrolledText).not.toContainEqual(expect.stringContaining('Alright'))
  })
})
