import { screen, waitFor, within } from '@testing-library/react'
import { graphql, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { deferred } from '../test/deferred'
import { meFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'
import { signIn } from '../test/signIn'

const ME = meFixture({ scope: 'profile' })
const LIBRARIES = [
  {
    __typename: 'Library' as const,
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Movies',
    type: 'MOVIE' as const,
  },
  {
    __typename: 'Library' as const,
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Series',
    type: 'SERIES' as const,
  },
]

function serveMe() {
  server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
}

// Signing in adopts the session without the entry probe, so the top bar's own Me is the one that
// fails or waits.
function serveSignIn() {
  server.use(
    http.post('/api/auth/login', () =>
      HttpResponse.json({ accessTokenExpiresAt: '2026-08-05T12:00:00Z', scope: 'profile' }),
    ),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('Home', () =>
      HttpResponse.json({ data: { continueWatching: [], libraries: [] } }),
    ),
  )
}

describe('TopBar', () => {
  it('renders a pill for Home plus one per library', async () => {
    serveMe()
    server.use(
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: LIBRARIES } })),
    )
    renderAppAt('/')

    expect(await screen.findByRole('link', { name: 'Movies' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Series' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
  })

  it('marks the Home pill active at /', async () => {
    serveMe()
    server.use(
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: LIBRARIES } })),
    )
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
              items: {
                edges: [],
                pageInfo: {
                  hasNextPage: false,
                  hasPreviousPage: false,
                  startCursor: null,
                  endCursor: null,
                },
              },
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
        HttpResponse.json({
          data: { libraries: [{ __typename: 'Library', id: 'x', name: null, type: 'MOVIE' }] },
        }),
      ),
    )
    renderAppAt('/')

    expect(await screen.findByRole('link', { name: 'Library' })).toBeInTheDocument()
  })

  it('degrades to Home-only chrome, without crashing or an error banner, when libraries fail to load', async () => {
    serveMe()
    server.use(
      graphql.query('Libraries', () => HttpResponse.json({ errors: [{ message: 'boom' }] })),
      graphql.query('Home', () =>
        HttpResponse.json({ data: { continueWatching: [], libraries: [] } }),
      ),
    )
    renderAppAt('/')

    expect(await screen.findByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldKeepTheLockupNavigationAndSignOutWhenTheAccountFailsToLoad', async () => {
    let revoked = false
    serveSignIn()
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          errors: [{ message: 'Account storage is offline.', extensions: { code: 'UNAVAILABLE' } }],
        }),
      ),
      http.post('/api/auth/refresh/revoke', () => {
        revoked = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { router, user } = renderAppAt('/login?redirect=/')

    await signIn(user)

    const banner = await screen.findByRole('banner')
    expect(within(banner).getByRole('img', { name: 'Streamarr' })).toBeInTheDocument()
    expect(within(banner).getByRole('link', { name: 'Home' })).toBeInTheDocument()
    const signOut = await within(banner).findByRole('button', { name: 'Sign out' })
    expect(within(banner).queryByRole('button', { name: /profile menu/i })).not.toBeInTheDocument()

    await user.click(signOut)

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(revoked).toBe(true)
  })

  it('shouldShowNoIdentityWhileTheAccountIsLoading', async () => {
    const account = deferred()
    serveSignIn()
    server.use(
      graphql.query('Me', async () => {
        await account.promise
        return HttpResponse.json({ data: { me: ME } })
      }),
    )
    const { user } = renderAppAt('/login?redirect=/')

    await signIn(user)

    const banner = await screen.findByRole('banner')
    expect(within(banner).getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(within(banner).queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(within(banner).queryByRole('button', { name: /profile menu/i })).not.toBeInTheDocument()

    account.resolve()

    expect(await within(banner).findByRole('button', { name: /profile menu/i })).toBeInTheDocument()
  })
})
