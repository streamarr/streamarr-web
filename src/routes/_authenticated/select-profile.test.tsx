import { screen, waitFor } from '@testing-library/react'
import { graphql, HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { meFixture, profileFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

const TOKENS = {
  accessToken: 'access',
  accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  scope: 'profile',
}

describe('/select-profile', () => {
  it('shouldOpenTheGateDirectlyFromTheMenuChoice', async () => {
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              profiles: [
                profileFixture({ id: 'p-alex', name: 'Alex', selected: true }),
                profileFixture({
                  id: 'p-toni',
                  name: 'Toni',
                  personal: false,
                  pinConfigured: true,
                }),
              ],
            }),
          },
        }),
      ),
    )
    const { router, user } = renderAppAt('/')

    await user.click(await screen.findByRole('button', { name: /profile menu \(alex\)/i }))
    await user.click(await screen.findByRole('button', { name: /toni \(pin protected\)/i }))

    expect(await screen.findByRole('heading', { name: /enter toni/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/select-profile')
    expect(router.state.location.search).toEqual({ profile: 'p-toni' })
  })

  it('shouldReturnToThePickerWithBrowserBack', async () => {
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              profiles: [
                profileFixture({ id: 'p-alex', name: 'Alex' }),
                profileFixture({
                  id: 'p-toni',
                  name: 'Toni',
                  personal: false,
                  pinConfigured: true,
                }),
              ],
            }),
          },
        }),
      ),
    )
    const { router, user } = renderAppAt('/select-profile')

    await user.click(await screen.findByRole('button', { name: /toni \(pin protected\)/i }))
    expect(await screen.findByRole('heading', { name: /enter toni/i })).toBeInTheDocument()

    router.history.back()

    expect(await screen.findByRole('heading', { name: /who's watching\?/i })).toBeInTheDocument()
    expect(screen.queryByTestId('pin-input')).not.toBeInTheDocument()
  })

  it('shouldNotReopenTheGateWithBackAfterSwitchingProfile', async () => {
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              profiles: [
                profileFixture({ id: 'p-alex', name: 'Alex' }),
                profileFixture({
                  id: 'p-toni',
                  name: 'Toni',
                  personal: false,
                  pinConfigured: true,
                }),
              ],
            }),
          },
        }),
      ),
    )
    const { router, user } = renderAppAt('/select-profile')

    await user.click(await screen.findByRole('button', { name: /toni \(pin protected\)/i }))
    expect(await screen.findByRole('heading', { name: /enter toni/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Switch profile' }))
    expect(await screen.findByRole('heading', { name: /who's watching\?/i })).toBeInTheDocument()

    router.history.back()

    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(screen.queryByRole('heading', { name: /enter toni/i })).not.toBeInTheDocument()
  })

  it('shouldOpenTheGateOnAFreshDeepLink', async () => {
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              profiles: [
                profileFixture({ id: 'p-alex', name: 'Alex' }),
                profileFixture({
                  id: 'p-toni',
                  name: 'Toni',
                  personal: false,
                  pinConfigured: true,
                }),
              ],
            }),
          },
        }),
      ),
    )
    renderAppAt('/select-profile?profile=p-toni')

    expect(await screen.findByRole('heading', { name: /enter toni/i })).toBeInTheDocument()
  })

  it('shouldFallBackToTheGridWhenTheGatedProfileIsLocked', async () => {
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              profiles: [
                profileFixture({ id: 'p-alex', name: 'Alex' }),
                profileFixture({
                  id: 'p-toni',
                  name: 'Toni',
                  personal: false,
                  pinConfigured: true,
                  locked: true,
                }),
              ],
            }),
          },
        }),
      ),
    )
    renderAppAt('/select-profile?profile=p-toni')

    expect(await screen.findByRole('heading', { name: /who's watching\?/i })).toBeInTheDocument()
    expect(screen.queryByTestId('pin-input')).not.toBeInTheDocument()
  })

  it('shouldSendADeadSessionBackToSignInFromTheGate', async () => {
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              profiles: [
                profileFixture({ id: 'p-alex', name: 'Alex' }),
                profileFixture({
                  id: 'p-toni',
                  name: 'Toni',
                  personal: false,
                  pinConfigured: true,
                }),
              ],
            }),
          },
        }),
      ),
      http.post('/api/auth/select-profile', () =>
        HttpResponse.json(
          { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' },
          { status: 401 },
        ),
      ),
    )
    const { router, user } = renderAppAt('/select-profile')

    await user.click(await screen.findByRole('button', { name: /toni \(pin protected\)/i }))
    await user.type(await screen.findByLabelText('PIN'), '4242')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/select-profile?profile=p-toni' })
  })

  it('shouldShowTheNewProfileAsActiveAfterAPinSwitch', async () => {
    let selectedId = 'p-alex'
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              profiles: [
                profileFixture({ id: 'p-alex', name: 'Alex', selected: selectedId === 'p-alex' }),
                profileFixture({
                  id: 'p-toni',
                  name: 'Toni',
                  personal: false,
                  pinConfigured: true,
                  selected: selectedId === 'p-toni',
                }),
              ],
            }),
          },
        }),
      ),
      http.post('/api/auth/select-profile', () => {
        selectedId = 'p-toni'
        return HttpResponse.json(TOKENS)
      }),
    )
    const { router, user } = renderAppAt('/select-profile')

    await user.click(await screen.findByRole('button', { name: /toni \(pin protected\)/i }))
    await user.type(await screen.findByLabelText('PIN'), '4242')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(
      await screen.findByRole('button', { name: /profile menu \(toni\)/i }),
    ).toBeInTheDocument()
  })
})
