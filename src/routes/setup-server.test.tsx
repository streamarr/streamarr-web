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
  let setupComplete = false
  server.use(
    http.get('/api/auth/status', () =>
      HttpResponse.json({ setupComplete, devicePairingEnabled: false }),
    ),
    http.post('/api/auth/setup', () => {
      setupComplete = true
      return HttpResponse.json(
        { accessTokenExpiresAt: '2026-08-05T12:00:00Z', scope },
        { status: 201 },
      )
    }),
    graphql.query('Me', () =>
      setupComplete
        ? HttpResponse.json({ data: { me: meFixture({ scope }) } })
        : HttpResponse.json({
            errors: [
              {
                message: 'Authentication is required.',
                extensions: { code: 'AUTHENTICATION_REQUIRED' },
              },
            ],
          }),
    ),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('Home', () =>
      HttpResponse.json({ data: { continueWatching: [], libraries: [] } }),
    ),
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

  it.each(['/', '/setup-server'])(
    'shouldOpenTheAppOnceSetupSignsInWithAProfile(%s)',
    async (path) => {
      serverCreatesTheFirstAccount('profile')
      const { router, user } = renderAppAt(path)

      await completeWizard(user)

      expect(await screen.findByText(/nothing to watch yet/i)).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/')
    },
  )

  it('shouldAskForAProfileOnceSetupSignsInWithoutOne', async () => {
    serverCreatesTheFirstAccount('account')
    const { router, user } = renderAppAt('/setup-server')

    await completeWizard(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/select-profile'))
  })

  it.each([500, 200])('shouldFailClosedWhenTheServerStatusCannotBeRead(%s)', async (status) => {
    server.use(http.get('/api/auth/status', () => HttpResponse.json({}, { status })))
    const { router } = renderAppAt('/setup-server')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(createAccount()).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/setup-server')
  })
})
