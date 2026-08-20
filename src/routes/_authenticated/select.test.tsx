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

describe('/select', () => {
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
    const { router, user } = renderAppAt('/select')

    await user.click(await screen.findByRole('button', { name: /toni \(pin protected\)/i }))
    await user.type(await screen.findByLabelText('PIN'), '4242')
    await user.click(screen.getByRole('button', { name: 'Watch' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    // The top bar's chip is the identity the person sees everywhere.
    expect(
      await screen.findByRole('button', { name: /profile menu \(toni\)/i }),
    ).toBeInTheDocument()
  })
})
