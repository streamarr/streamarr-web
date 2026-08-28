import { screen, waitFor } from '@testing-library/react'
import { graphql, HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import type { MeQuery } from '../graphql/generated/graphql'
import { meFixture, profileFixture } from '../test/meFixture'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { ProfileMenu } from './ProfileMenu'

const TOKENS = {
  accessToken: 'access',
  accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  scope: 'profile',
}

function household(): MeQuery['me'] {
  const profiles = [
    profileFixture({ id: 'p-alex', name: 'Alex', selected: true }),
    profileFixture({ id: 'p-sam', name: 'Sam', personal: false }),
    profileFixture({ id: 'p-toni', name: 'Toni', personal: false, pinConfigured: true }),
    profileFixture({ id: 'p-rob', name: 'Rob', personal: false, locked: true }),
  ]
  return { ...meFixture({ profiles }), serverAdmin: true } as MeQuery['me']
}

async function openMenu(user: ReturnType<typeof import('@testing-library/user-event').default.setup>) {
  await user.click(screen.getByRole('button', { name: /profile menu \(alex\)/i }))
}

describe('ProfileMenu', () => {
  it('shouldShowEveryProfileWithTheCurrentOneLeading', async () => {
    const { user } = renderWithProviders(
      <ProfileMenu me={household()} onPinRequired={vi.fn()} onSignedOut={vi.fn()} />,
    )

    await openMenu(user)

    // The current profile is marked, carries its role, and is not a button to press again.
    const current = await screen.findByRole('button', { name: 'Alex' })
    expect(current).toBeDisabled()
    expect(screen.getByText('Server owner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sam' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /toni \(pin protected\)/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /rob \(locked\)/i })).toBeDisabled()
  })

  it('shouldSwitchToAPinlessProfileDirectly', async () => {
    let selected: unknown = null
    server.use(
      http.post('/api/auth/select-profile', async ({ request }) => {
        selected = await request.json()
        return HttpResponse.json(TOKENS)
      }),
      graphql.query('Me', () => HttpResponse.json({ data: { me: household() } })),
    )
    const { user } = renderWithProviders(
      <ProfileMenu me={household()} onPinRequired={vi.fn()} onSignedOut={vi.fn()} />,
    )

    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'Sam' }))

    await waitFor(() => expect(selected).toEqual({ profileId: 'p-sam' }))
  })

  it('shouldDetourAPinProtectedProfileThroughTheGate', async () => {
    const selectProfile = vi.fn()
    server.use(
      http.post('/api/auth/select-profile', () => {
        selectProfile()
        return HttpResponse.json(TOKENS)
      }),
    )
    const onPinRequired = vi.fn()
    const { user } = renderWithProviders(
      <ProfileMenu me={household()} onPinRequired={onPinRequired} onSignedOut={vi.fn()} />,
    )

    await openMenu(user)
    await user.click(screen.getByRole('button', { name: /toni \(pin protected\)/i }))

    expect(onPinRequired).toHaveBeenCalledWith('p-toni')
    expect(selectProfile).not.toHaveBeenCalled()
  })

  it('shouldSignOutAndHandOffNavigation', async () => {
    let revoked = false
    server.use(
      http.post('/api/auth/refresh/revoke', () => {
        revoked = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const onSignedOut = vi.fn()
    const { user } = renderWithProviders(
      <ProfileMenu me={household()} onPinRequired={vi.fn()} onSignedOut={onSignedOut} />,
    )

    await openMenu(user)
    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(onSignedOut).toHaveBeenCalled())
    expect(revoked).toBe(true)
  })
})
