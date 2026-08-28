import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const ME = {
  accountId: '11111111-1111-1111-1111-111111111111',
  email: 'owner@example.com',
  displayName: 'Owner',
  role: 'ADMIN',
  scope: 'account',
  memberships: [],
}

function serverAcceptsCredentials(scope: 'account' | 'profile') {
  server.use(
    http.post('/api/auth/login', () =>
      HttpResponse.json({ accessTokenExpiresAt: '2026-08-05T12:00:00Z', scope }),
    ),
    graphql.query('Me', () => HttpResponse.json({ data: { me: { ...ME, scope } } })),
  )
}

async function signIn(user: Awaited<ReturnType<typeof renderAppAt>>['user']) {
  await user.type(await screen.findByLabelText(/email/i), 'owner@example.com')
  await user.type(screen.getByLabelText(/^password/i), 'hunter2!')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('/login gate', () => {
  it('shouldBounceAKnownSignedInVisitorAwayFromSignIn', async () => {
    // Only the cached answer drives this: /login must stay reachable with the server down
    // (see shouldLeaveSignInReachableWithoutAskingTheServer), so the bounce covers exactly the
    // visitor this page can teach nothing — one the server vouched for in this document's life.
    server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
    const { router } = renderAppAt('/')
    await screen.findByText(/welcome, owner/i)

    await router.navigate({ to: '/login' })

    expect(router.state.location.pathname).toBe('/')
  })
})

describe('/login resume', () => {
  it('shouldResumeTheInterruptedDestinationAfterSigningIn', async () => {
    serverAcceptsCredentials('account')
    const { router, user } = renderAppAt('/login?redirect=/link')

    await signIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/link'))
    expect(await screen.findByLabelText(/pairing code/i)).toBeInTheDocument()
  })

  it('shouldResumeAnyInAppDestination', async () => {
    // The resumable destination is wherever the visitor was interrupted — not a whitelist.
    serverAcceptsCredentials('account')
    const { router, user } = renderAppAt('/login?redirect=/')

    await signIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByText(/welcome, owner/i)).toBeInTheDocument()
  })

  it('shouldCarryAPendingPairingCodeThroughSignIn', async () => {
    serverAcceptsCredentials('account')
    const { router, user } = renderAppAt('/login?redirect=%2Flink%3Fcode%3DBCDF-GHJK')

    await signIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/link'))
    expect(await screen.findByLabelText(/pairing code/i)).toHaveValue('BCDF-GHJK')
  })

  it('shouldRefuseAnExternalResumeTarget', async () => {
    serverAcceptsCredentials('profile')
    const { router, user } = renderAppAt('/login?redirect=https://evil.example/phish')

    await signIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('shouldRefuseAProtocolRelativeResumeTarget', async () => {
    serverAcceptsCredentials('profile')
    const { router, user } = renderAppAt('/login?redirect=//evil.example/phish')

    await signIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('shouldFallBackByScopeWhenNothingToResume', async () => {
    serverAcceptsCredentials('account')
    const { router, user } = renderAppAt('/login')

    await signIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/select'))
  })
})
