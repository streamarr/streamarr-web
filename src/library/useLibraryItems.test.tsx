import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { LibraryPageQuery, MediaFilter, MediaSort } from '../graphql/generated/graphql'
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
}): LibraryPageQuery {
  return {
    library: {
      id: LIBRARY_ID,
      name: 'Movies',
      status: 'HEALTHY',
      scanCompletedOn: '2026-08-28T11:00:00Z',
      alphabetIndex: [{ letter: 'A', count: 1 }, { letter: 'N', count: 1 }],
      items: {
        edges: overrides.edges,
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

function Harness({ initialFilter = {} }: { initialFilter?: MediaFilter }) {
  const [filter, setFilter] = useState<MediaFilter>(initialFilter)
  const result = useLibraryItems({ libraryId: LIBRARY_ID, sort: TITLE_ASC, filter })
  return (
    <div>
      <div data-testid="loading">{String(result.loading)}</div>
      <div data-testid="hasNextPage">{String(result.hasNextPage)}</div>
      <ul>
        {result.edges.map((edge) => (
          <li key={edge.cursor}>{edge.node.title}</li>
        ))}
      </ul>
      <button type="button" onClick={result.loadMore}>
        Load more
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
    </div>
  )
}

describe('useLibraryItems', () => {
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
      graphql.query('LibraryPage', ({ variables }) => {
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

  it('replaces edges with the seek page and issues one backward fetch when hasPreviousPage is true', async () => {
    let backwardFetches = 0
    server.use(
      graphql.query('LibraryPage', ({ variables }) => {
        if (variables.before) {
          backwardFetches += 1
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

    await waitFor(() => expect(screen.getByText('Alright')).toBeInTheDocument())
    expect(screen.getByText('Northern Line')).toBeInTheDocument()
    expect(backwardFetches).toBe(1)
  })

  it('issues no backward fetch when the seek page has no previous page', async () => {
    let backwardFetches = 0
    server.use(
      graphql.query('LibraryPage', ({ variables }) => {
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

  it('resets the accumulated edges when the filter changes', async () => {
    server.use(
      graphql.query('LibraryPage', ({ variables }) => {
        if (variables.filter?.watchStatus === 'UNWATCHED') {
          return HttpResponse.json({
            data: libraryResponse({ edges: [{ cursor: 'c-u', node: movieNode('5', 'Unwatched Title') }] }),
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
})
