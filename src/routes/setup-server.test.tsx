import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'
import { meFixture } from '../test/meFixture'

function serverStatus(setupComplete: boolean) {
  server.use(
    http.get('/api/auth/status', () =>
      HttpResponse.json({ setupComplete, devicePairingEnabled: false }),
    ),
  )
}

const createAccount = () => screen.queryByRole('button', { name: /create account/i })

function serverCreatesTheFirstAccount(scope: 'account' | 'profile') {
  serverStatus(false)
  server.use(
    http.post('/api/auth/setup', () =>
      HttpResponse.json({ accessTokenExpiresAt: '2026-08-05T12:00:00Z', scope }, { status: 201 }),
    ),
    graphql.query('Me', () => HttpResponse.json({ data: { me: meFixture({ scope }) } })),
  )
}

async function completeWizard(user: ReturnType<typeof renderAppAt>['user']) {
  await user.type(await screen.findByLabelText(/^email/i), 'admin@example.com')
  await user.type(screen.getByLabelText(/display name/i), 'Admin')
  await user.type(screen.getByLabelText(/^password/i), 'correct horse battery staple')
  await user.type(screen.getByLabelText(/household name/i), 'Home')
  await user.type(screen.getByLabelText(/profile name/i), 'Owner')
  await user.click(screen.getByRole('button', { name: /create account/i }))
}

describe('/setup-server', () => {
  it('shouldShowTheWizardOnAFreshServer', async () => {
    serverStatus(false)
    const { router } = renderAppAt('/setup-server')

    expect(await screen.findByRole('button', { name: /create account/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/setup-server')
  })

  it('shouldReplaceItselfWithSignInOnceTheServerIsSetUp', async () => {
    serverStatus(true)
    const { router } = renderAppAt('/setup-server')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    // A replace, not a push: Back must not return to a gate that bounces again.
    expect(router.history.canGoBack()).toBe(false)
    expect(createAccount()).not.toBeInTheDocument()
  })

  it('shouldOpenTheAppOnceSetupSignsInWithAProfile', async () => {
    serverCreatesTheFirstAccount('profile')
    const { router, user } = renderAppAt('/setup-server')

    await completeWizard(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('shouldAskForAProfileOnceSetupSignsInWithoutOne', async () => {
    serverCreatesTheFirstAccount('account')
    const { router, user } = renderAppAt('/setup-server')

    await completeWizard(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/select-profile'))
  })

  it('shouldFailClosedWhenTheServerStatusCannotBeRead', async () => {
    server.use(http.get('/api/auth/status', () => HttpResponse.json({}, { status: 500 })))
    const { router } = renderAppAt('/setup-server')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(createAccount()).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/setup-server')
  })
})
