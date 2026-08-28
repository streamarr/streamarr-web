import { screen, waitFor } from '@testing-library/react'
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
} = {}): LibraryPageQuery {
  return {
    library: {
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
          startCursor: 'c1',
          endCursor: 'c1',
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
})
