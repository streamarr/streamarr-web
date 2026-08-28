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

const DENIED = {
  code: 'PROFILE_ACCESS_DENIED',
  message: 'The requested profile is not accessible to this account.',
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

type MenuProps = Parameters<typeof ProfileMenu>[0]

function renderMenu(overrides: Partial<MenuProps> = {}) {
  return renderWithProviders(
    <ProfileMenu
      me={household()}
      onPinRequired={vi.fn()}
      onSignedOut={vi.fn()}
      onUnauthenticated={vi.fn()}
      {...overrides}
    />,
  )
}

async function openMenu(user: ReturnType<typeof import('@testing-library/user-event').default.setup>) {
  await user.click(screen.getByRole('button', { name: /profile menu \(alex\)/i }))
}

describe('ProfileMenu', () => {
  it('shouldShowEveryProfileWithTheCurrentOneLeading', async () => {
    const { user } = renderMenu()

    await openMenu(user)

    // The current profile is marked, carries its role, and is not a button to press again.
    const current = await screen.findByRole('button', { name: 'Alex' })
    expect(current).toBeDisabled()
    expect(screen.getByText('Server owner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sam' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /toni \(pin protected\)/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /rob \(locked\)/i })).toBeDisabled()
  })

  it('shouldReturnFocusToTheChipWhenEscapeClosesThePanel', async () => {
    const { user } = renderMenu()
    const chip = screen.getByRole('button', { name: /profile menu \(alex\)/i })

    await user.click(chip)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Sam' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('button', { name: 'Sam' })).not.toBeInTheDocument()
    expect(chip).toHaveFocus()
    expect(chip).toHaveAttribute('aria-expanded', 'false')
  })

  it('shouldDiscloseThePanelRatherThanClaimAMenuRole', async () => {
    const { user } = renderMenu()
    const chip = screen.getByRole('button', { name: /profile menu \(alex\)/i })

    await user.click(chip)

    const panel = document.getElementById(chip.getAttribute('aria-controls') ?? '')
    expect(panel).not.toBeNull()
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Sam' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(chip).not.toHaveAttribute('aria-haspopup')
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
    const { user } = renderMenu()

    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'Sam' }))

    await waitFor(() => expect(selected).toEqual({ profileId: 'p-sam' }))
  })

  it('shouldReportARefusedSwitchInsideThePanel', async () => {
    server.use(
      http.post('/api/auth/select-profile', () => HttpResponse.json(DENIED, { status: 403 })),
    )
    const { user } = renderMenu()

    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'Sam' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(DENIED.message)
    expect(screen.getByRole('button', { name: 'Sam' })).toBeEnabled()
  })

  it('shouldHandASessionEvictionToTheCaller', async () => {
    server.use(
      http.post('/api/auth/select-profile', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const onUnauthenticated = vi.fn()
    const { user } = renderMenu({ onUnauthenticated })

    await openMenu(user)
    await user.click(screen.getByRole('button', { name: 'Sam' }))

    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
    const { user } = renderMenu({ onPinRequired })

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
    const { user } = renderMenu({ onSignedOut })

    await openMenu(user)
    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(onSignedOut).toHaveBeenCalled())
    expect(revoked).toBe(true)
  })
})
