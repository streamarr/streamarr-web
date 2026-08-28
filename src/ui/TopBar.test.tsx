import { screen, waitFor } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { meFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const ME = meFixture({ scope: 'profile' })
const LIBRARIES = [
  { __typename: 'Library' as const, id: '11111111-1111-1111-1111-111111111111', name: 'Movies', type: 'MOVIE' as const },
  { __typename: 'Library' as const, id: '22222222-2222-2222-2222-222222222222', name: 'Series', type: 'SERIES' as const },
]

function serveMe() {
  server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
}

describe('TopBar', () => {
  it('renders a pill for Home plus one per library', async () => {
    serveMe()
    server.use(graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: LIBRARIES } })))
    renderAppAt('/')

    expect(await screen.findByRole('link', { name: 'Movies' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Series' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
  })

  it('marks the Home pill active at /', async () => {
    serveMe()
    server.use(graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: LIBRARIES } })))
    renderAppAt('/')

    await waitFor(() => expect(screen.getByRole('link', { name: 'Movies' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Home' }).className).toMatch(/navPillActive/)
    expect(screen.getByRole('link', { name: 'Movies' }).className).not.toMatch(/navPillActive/)
  })

  it('marks the matching library pill active on its own page', async () => {
    serveMe()
    server.use(
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: LIBRARIES } })),
      graphql.query('LibraryPage', () =>
        HttpResponse.json({
          data: {
            library: {
              id: LIBRARIES[0].id,
              name: 'Movies',
              status: 'HEALTHY',
              scanCompletedOn: null,
              alphabetIndex: [],
              items: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } },
            },
          },
        }),
      ),
    )
    renderAppAt(`/library/${LIBRARIES[0].id}`)

    await waitFor(() => expect(screen.getByRole('link', { name: 'Movies' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Movies' }).className).toMatch(/navPillActive/)
    expect(screen.getByRole('link', { name: 'Home' }).className).not.toMatch(/navPillActive/)
  })

  it('falls back to a fallback label for a library with no name', async () => {
    serveMe()
    server.use(
      graphql.query('Libraries', () =>
        HttpResponse.json({ data: { libraries: [{ __typename: 'Library', id: 'x', name: null, type: 'MOVIE' }] } }),
      ),
    )
    renderAppAt('/')

    expect(await screen.findByRole('link', { name: 'Library' })).toBeInTheDocument()
  })

  it('degrades to Home-only chrome, without crashing or an error banner, when libraries fail to load', async () => {
    serveMe()
    server.use(
      graphql.query('Libraries', () => HttpResponse.json({ errors: [{ message: 'boom' }] })),
      graphql.query('Home', () => HttpResponse.json({ data: { continueWatching: [], libraries: [] } })),
    )
    renderAppAt('/')

    expect(await screen.findByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
