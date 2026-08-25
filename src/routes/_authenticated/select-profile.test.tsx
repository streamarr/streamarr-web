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
    // Choosing a protected Profile in the top bar's menu IS the choice — landing on the
    // picker grid to click the same Profile again would ask the question twice.
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
    // The gate is a history entry, not component state: the browser's own Back is the way
    // out, no bespoke back button needed.
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

  it('shouldOpenTheGateOnAFreshDeepLink', async () => {
    // A refresh on the gate stays on the gate: the URL carries the whole state.
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
    // A stale or hand-edited deep link must never open a gate the picker itself would
    // refuse: a locked Profile is visible but not selectable (principle 7.2).
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
    // The server's truth moves when the selection succeeds; the client must not keep showing
    // the old identity from its cache.
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
    // The top bar's chip is the identity the person sees everywhere.
    expect(
      await screen.findByRole('button', { name: /profile menu \(toni\)/i }),
    ).toBeInTheDocument()
  })
})
