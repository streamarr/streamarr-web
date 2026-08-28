import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'
import { meFixture } from '../test/meFixture'

const ME = meFixture({ scope: 'profile' })

describe('the authenticated layout', () => {
  it('shouldShowOnlyTheCheckWhileTheServerHasNotAnswered', async () => {
    // While the answer is pending nothing but the check may show — not the page, whose own
    // loading states only exist for visitors already past the gate.
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
    // The bounce records where the visitor was headed so signing in can resume it.
    expect(router.state.location.search).toEqual({ redirect: '/' })
  })

  it('shouldBounceAnExpiredUnrenewedSessionToSignIn', async () => {
    // An expired token that reaches the probe escaped every renewal layer — a verdict about
    // the session, not an outage. A reload-and-retry alert cannot help; signing in can.
    server.use(
      http.post('/graphql', () => HttpResponse.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })),
    )
    const { router } = renderAppAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/' })
  })

  it('shouldRenderTheGuardedPageForASignedInVisitor', async () => {
    server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
    const { router } = renderAppAt('/')

    expect(await screen.findByText(/welcome, owner/i)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('shouldSignOutFromTheHeaderAndReturnToSignIn', async () => {
    let loggedOut = false
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      http.post('/api/auth/refresh/revoke', () => {
        loggedOut = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { router, user } = renderAppAt('/')
    await screen.findByText(/welcome, owner/i)

    // Sign out lives in the profile menu now (frame 01a).
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
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      http.post('/api/auth/refresh/revoke', async () => {
        await revocation
        return HttpResponse.json({}, { status: 503 })
      }),
    )
    const { router, user } = renderAppAt('/')
    await screen.findByText(/welcome, owner/i)

    await user.click(await screen.findByRole('button', { name: /profile menu/i }))
    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    finishRevocation()
  })

  it('shouldHideSignOutFromAVisitorWhoIsNotSignedIn', async () => {
    const { router } = renderAppAt('/login')

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('shouldRestartProactiveRenewalAfterAuthenticatedHardReload', async () => {
    server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
    const renewal = {
      adoptExpiry: vi.fn(),
      refreshNow: vi.fn(async () => ({ kind: 'renewed' as const, expiresAt: '2026-08-06T12:10:00Z' })),
      stop: vi.fn(),
    }

    renderAppAt('/', renewal)

    await waitFor(() => expect(renewal.refreshNow).toHaveBeenCalledOnce())
  })

  it('shouldLeaveSignInReachableWithoutAskingTheServer', async () => {
    // No MSW handlers at all: if the gate probed the server from /login, the unhandled request
    // would fail this test loudly.
    const { router } = renderAppAt('/login')

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('shouldFailClosedWithAnAlertWhenTheServerCannotAnswer', async () => {
    // An outage is not a verdict: neither the page nor a misleading bounce to sign-in — the
    // visitor may well be signed in. Say so and let them retry.
    server.use(http.post('/graphql', () => HttpResponse.json({}, { status: 500 })))
    const { router } = renderAppAt('/')

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't confirm/i)
    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByText(/welcome/i)).not.toBeInTheDocument()
  })
})
