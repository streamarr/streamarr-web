import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'
import { meFixture, profileFixture } from '../test/meFixture'

// Once signed in, the chrome mounts Home + TopBar, which fire their own queries.
function homeHandlers() {
  return [
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('Home', () => HttpResponse.json({ data: { continueWatching: [], libraries: [] } })),
  ]
}

const ME = meFixture({ scope: 'profile' })
const HOUSEHOLD = meFixture({
  scope: 'profile',
  profiles: [
    profileFixture({ id: 'p-alex', name: 'Alex', selected: true }),
    profileFixture({ id: 'p-sam', name: 'Sam', personal: false }),
  ],
})

describe('the authenticated layout', () => {
  it('shouldShowOnlyTheCheckWhileTheServerHasNotAnswered', async () => {
    let answer = () => {}
    const held = new Promise<void>((resolve) => {
      answer = resolve
    })
    server.use(
      http.post('/graphql', async () => {
        await held
        return HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 })
      }),
    )
    const { router } = renderAppAt('/')

    expect(
      await screen.findByRole('status', { name: /checking your account/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/welcome/i)).not.toBeInTheDocument()

    answer()
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('shouldBounceAnAnonymousVisitorToSignIn', async () => {
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { router } = renderAppAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/' })
  })

  it('shouldBounceAnExpiredUnrenewedSessionToSignIn', async () => {
    // An expired token that reaches the probe escaped every renewal layer: a verdict, not an outage.
    server.use(
      http.post('/graphql', () => HttpResponse.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })),
    )
    const { router } = renderAppAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/' })
  })

  it('shouldRenderTheGuardedPageForASignedInVisitor', async () => {
    server.use(...homeHandlers(), graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
    const { router } = renderAppAt('/')

    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('shouldSignOutFromTheHeaderAndReturnToSignIn', async () => {
    let loggedOut = false
    server.use(
      ...homeHandlers(),
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      http.post('/api/auth/refresh/revoke', () => {
        loggedOut = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { router, user } = renderAppAt('/')
    await screen.findByRole('banner')

    await user.click(await screen.findByRole('button', { name: /profile menu/i }))
    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(loggedOut).toBe(true)
  })

  it('shouldReturnToSignInBeforeServerRevocationFinishes', async () => {
    let finishRevocation = () => {}
    const revocation = new Promise<void>((resolve) => {
      finishRevocation = resolve
    })
    server.use(
      ...homeHandlers(),
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      http.post('/api/auth/refresh/revoke', async () => {
        await revocation
        return HttpResponse.json({}, { status: 503 })
      }),
    )
    const { router, user } = renderAppAt('/')
    await screen.findByRole('banner')

    await user.click(await screen.findByRole('button', { name: /profile menu/i }))
    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    finishRevocation()
  })

  it('shouldReturnToSignInWhenAProfileSwitchFindsTheSessionGone', async () => {
    server.use(
      ...homeHandlers(),
      graphql.query('Me', () => HttpResponse.json({ data: { me: HOUSEHOLD } })),
      http.post('/api/auth/select-profile', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { router, user } = renderAppAt('/')
    await screen.findByRole('banner')

    await user.click(await screen.findByRole('button', { name: /profile menu/i }))
    await user.click(screen.getByRole('button', { name: 'Sam' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('shouldHideSignOutFromAVisitorWhoIsNotSignedIn', async () => {
    const { router } = renderAppAt('/login')

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('shouldRestartProactiveRenewalAfterAuthenticatedHardReload', async () => {
    server.use(...homeHandlers(), graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
    const renewal = {
      adoptExpiry: vi.fn(),
      refreshNow: vi.fn(async () => ({ kind: 'renewed' as const, expiresAt: '2026-08-06T12:10:00Z' })),
      stop: vi.fn(),
    }

    renderAppAt('/', renewal)

    await waitFor(() => expect(renewal.refreshNow).toHaveBeenCalledOnce())
  })

  it('shouldLeaveSignInReachableWithoutAskingTheServer', async () => {
    // No MSW handlers at all: a probe from /login would fail this test loudly.
    const { router } = renderAppAt('/login')

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('shouldFailClosedWithAnAlertWhenTheServerCannotAnswer', async () => {
    server.use(http.post('/graphql', () => HttpResponse.json({}, { status: 500 })))
    const { router } = renderAppAt('/')

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't confirm/i)
    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByText(/welcome/i)).not.toBeInTheDocument()
  })
})
