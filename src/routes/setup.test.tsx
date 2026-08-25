import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

function serverStatus(setupComplete: boolean) {
  server.use(
    http.get('/api/auth/status', () =>
      HttpResponse.json({ setupComplete, devicePairingEnabled: false }),
    ),
  )
}

const createAccount = () => screen.queryByRole('button', { name: /create account/i })

describe('/setup', () => {
  it('shouldShowTheWizardOnAFreshServer', async () => {
    serverStatus(false)
    const { router } = renderAppAt('/setup')

    expect(await screen.findByRole('button', { name: /create account/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/setup')
  })

  it('shouldReplaceItselfWithSignInOnceTheServerIsSetUp', async () => {
    serverStatus(true)
    const { router } = renderAppAt('/setup')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    // A replace, not a push: Back must not return to a gate that bounces again.
    expect(router.history.canGoBack()).toBe(false)
    expect(createAccount()).not.toBeInTheDocument()
  })

  it('shouldFailClosedWhenTheServerStatusCannotBeRead', async () => {
    server.use(http.get('/api/auth/status', () => HttpResponse.json({}, { status: 500 })))
    const { router } = renderAppAt('/setup')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(createAccount()).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/setup')
  })
})
