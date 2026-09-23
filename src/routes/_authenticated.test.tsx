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
    graphql.query('Home', () =>
      HttpResponse.json({ data: { continueWatching: [], libraries: [] } }),
    ),
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

function setupStatus(setupComplete: boolean) {
  return http.get('/api/auth/status', () =>
    HttpResponse.json({ setupComplete, devicePairingEnabled: false }),
  )
}

describe('the authenticated layout', () => {
  it('shouldShowOnlyTheCheckWhileTheServerHasNotAnswered', async () => {
    let answer = () => {}
    const held = new Promise<void>((resolve) => {
      answer = resolve
    })
    server.use(
      setupStatus(true),
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

  it('shouldOpenSetupForAnAnonymousRootVisitOnAFreshServer', async () => {
    server.use(
      setupStatus(false),
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { router } = renderAppAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/setup-server'))
    expect(await screen.findByRole('button', { name: /create account/i })).toBeInTheDocument()
    expect(router.history.canGoBack()).toBe(false)
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('shouldBounceAnAnonymousRootVisitToSignInOnceTheServerIsSetUp', async () => {
    server.use(
      setupStatus(true),
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { router } = renderAppAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/' })
  })

  it.each([
    '/link?code=BCDF-GHJK',
    '/sharing',
    '/library/library-1?by=ADDED&direction=DESC',
    '/play/media-1',
    '/select-profile',
  ])('shouldSendOtherAnonymousVisitsToSignInWithoutCheckingSetup(%s)', async (path) => {
    const readStatus = vi.fn(() =>
      HttpResponse.json({ setupComplete: false, devicePairingEnabled: false }),
    )
    server.use(
      http.get('/api/auth/status', readStatus),
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { router } = renderAppAt(path)

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toEqual({ redirect: path })
    expect(readStatus).not.toHaveBeenCalled()
  })

  it('shouldBounceAnExpiredUnrenewedSessionToSignIn', async () => {
    // An expired token that reaches the probe escaped every renewal layer: a verdict, not an outage.
    server.use(
      setupStatus(true),
      http.post('/graphql', () => HttpResponse.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })),
    )
    const { router } = renderAppAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/' })
  })

  it('shouldRenderTheGuardedPageForASignedInVisitor', async () => {
    const readStatus = vi.fn(() => HttpResponse.error())
    server.use(
      ...homeHandlers(),
      http.get('/api/auth/status', readStatus),
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    )
    const { router } = renderAppAt('/')

    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(readStatus).not.toHaveBeenCalled()
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

  it('shouldAskForAProfileWhenTheServerRequiresOneMidSession', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('SharingOverview', () =>
        HttpResponse.json({
          errors: [{ message: 'profile required', extensions: { code: 'PROFILE_REQUIRED' } }],
        }),
      ),
    )
    const { router } = renderAppAt('/sharing')

    await waitFor(() => expect(router.state.location.pathname).toBe('/select-profile'))
  })

  it('shouldHideSignOutFromAVisitorWhoIsNotSignedIn', async () => {
    const { router } = renderAppAt('/login')

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('shouldRestartProactiveRenewalAfterAuthenticatedHardReload', async () => {
    server.use(
      ...homeHandlers(),
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    )
    const renewal = {
      adoptExpiry: vi.fn(),
      refreshNow: vi.fn(async () => ({
        kind: 'renewed' as const,
        expiresAt: '2026-08-06T12:10:00Z',
      })),
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

  it('shouldKeepTheEntryPendingUntilSetupStatusIsKnown', async () => {
    let answer = () => {}
    const held = new Promise<void>((resolve) => {
      answer = resolve
    })
    const readStatus = vi.fn(async () => {
      await held
      return HttpResponse.json({ setupComplete: false, devicePairingEnabled: false })
    })
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
      http.get('/api/auth/status', readStatus),
    )
    const { router } = renderAppAt('/')

    await waitFor(() => expect(readStatus).toHaveBeenCalled())
    expect(screen.getByRole('status', { name: /checking your account/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument()

    answer()
    expect(await screen.findByRole('button', { name: /create account/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/setup-server')
  })

  it.each([
    { condition: 'TheStatusEndpointFails', response: () => HttpResponse.json({}, { status: 503 }) },
    { condition: 'TheNetworkFails', response: () => HttpResponse.error() },
    { condition: 'TheStatusIsNotJson', response: () => HttpResponse.text('unavailable') },
    { condition: 'TheSetupFlagIsMissing', response: () => HttpResponse.json({}) },
  ])('shouldFailClosedAndOfferSignInWhen$condition', async ({ response }) => {
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
      http.get('/api/auth/status', response),
    )
    const { router, user } = renderAppAt('/')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't check whether this server is set up. Reload the page to try again.",
    )
    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByRole('button', { name: /create account/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /sign in/i }))

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
