import { screen, waitFor } from '@testing-library/react'
import { graphql, http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import {
  HOUSEHOLD_ID,
  meFixture,
  PROFILE_ID,
  profileFixture,
} from '../test/meFixture'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { Picker } from './Picker'

const OTHER_HOUSEHOLD_ID = '55555555-5555-5555-5555-555555555555'
const TOKENS = { accessTokenExpiresAt: '2026-08-20T12:10:00Z', scope: 'profile' }

describe('Picker', () => {
  it('shouldSelectAnUnprotectedProfileDirectly', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: meFixture() } })),
      http.post('/api/auth/select-profile', async ({ request }) => {
        expect(await request.json()).toEqual({ profileId: PROFILE_ID })
        return HttpResponse.json(TOKENS)
      }),
    )
    const onProfileSelected = vi.fn()
    const { user } = renderWithProviders(<Picker onProfileSelected={onProfileSelected} />)

    await user.click(await screen.findByRole('button', { name: /Alex/ }))

    await waitFor(() => expect(onProfileSelected).toHaveBeenCalledWith(TOKENS))
  })

  it('shouldGateAProtectedProfileBehindItsPin', async () => {
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: { me: meFixture({ profiles: [profileFixture({ pinConfigured: true })] }) },
        }),
      ),
      http.post('/api/auth/select-profile', async ({ request }) => {
        const body = (await request.json()) as { pin?: string }
        if (body.pin !== '4242') {
          return HttpResponse.json({ code: 'INVALID_PROFILE_PIN' }, { status: 401 })
        }
        return HttpResponse.json(TOKENS)
      }),
    )
    const onProfileSelected = vi.fn()
    const { user } = renderWithProviders(<Picker onProfileSelected={onProfileSelected} />)

    await user.click(await screen.findByRole('button', { name: /Alex/ }))
    const pinInput = await screen.findByTestId('pin-input')

    // The wrong PIN earns the typed refusal and the dialog stays for another try.
    await user.type(pinInput, '1111')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("That PIN isn't right")
    expect(onProfileSelected).not.toHaveBeenCalled()

    await user.type(screen.getByTestId('pin-input'), '4242')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await waitFor(() => expect(onProfileSelected).toHaveBeenCalledWith(TOKENS))
  })

  it('shouldSubmitThePinWithEnter', async () => {
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              profiles: [profileFixture({ name: 'Alex', pinConfigured: true })],
            }),
          },
        }),
      ),
      http.post('/api/auth/select-profile', () => HttpResponse.json(TOKENS)),
    )
    const onProfileSelected = vi.fn()
    const { user } = renderWithProviders(<Picker onProfileSelected={onProfileSelected} />)
    await user.click(await screen.findByRole('button', { name: /Alex/ }))

    await user.type(await screen.findByTestId('pin-input'), '4242{Enter}')

    await waitFor(() => expect(onProfileSelected).toHaveBeenCalledWith(TOKENS))
  })

  it('shouldIgnoreEnterWhileThePinIsShort', async () => {
    const selectProfile = vi.fn()
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              profiles: [profileFixture({ name: 'Alex', pinConfigured: true })],
            }),
          },
        }),
      ),
      http.post('/api/auth/select-profile', () => {
        selectProfile()
        return HttpResponse.json(TOKENS)
      }),
    )
    const { user } = renderWithProviders(<Picker onProfileSelected={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /Alex/ }))

    await user.type(await screen.findByTestId('pin-input'), '42{Enter}')

    expect(selectProfile).not.toHaveBeenCalled()
  })

  it('shouldShowALockedProfileWithoutLettingItBeChosen', async () => {
    const selectProfile = vi.fn()
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              profiles: [profileFixture({ name: 'Kids', kind: 'KID', locked: true })],
            }),
          },
        }),
      ),
      http.post('/api/auth/select-profile', () => {
        selectProfile()
        return HttpResponse.json(TOKENS)
      }),
    )
    const { user } = renderWithProviders(<Picker onProfileSelected={vi.fn()} />)

    // The tile is genuinely disabled; the lock reads from the glyph, not prose.
    const locked = await screen.findByRole('button', { name: /Kids \(locked\)/ })
    expect(locked).toBeDisabled()
    await user.click(locked)

    expect(screen.queryByTestId('pin-input')).not.toBeInTheDocument()
    expect(selectProfile).not.toHaveBeenCalled()
  })

  it('shouldSwitchHouseholdsAndReloadTheirProfiles', async () => {
    const twoHouseholds = {
      usableHouseholds: [
        { id: HOUSEHOLD_ID, name: 'Smith Family', membership: true },
        { id: OTHER_HOUSEHOLD_ID, name: 'Cabin', membership: false },
      ],
    }
    let switched = false
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: switched
              ? meFixture({
                  ...twoHouseholds,
                  contextHouseholdId: OTHER_HOUSEHOLD_ID,
                  contextHouseholdName: 'Cabin',
                  profiles: [profileFixture({ id: '66666666-6666-6666-6666-666666666666', name: 'Visiting Alex' })],
                })
              : meFixture(twoHouseholds),
          },
        }),
      ),
      http.post('/api/auth/select-household', async ({ request }) => {
        expect(await request.json()).toEqual({ householdId: OTHER_HOUSEHOLD_ID })
        switched = true
        return HttpResponse.json({ ...TOKENS, scope: 'account' })
      }),
    )
    const { user } = renderWithProviders(<Picker onProfileSelected={vi.fn()} />)

    await user.click(await screen.findByRole('radio', { name: 'Cabin' }))

    expect(await screen.findByRole('button', { name: /Visiting Alex/ })).toBeInTheDocument()
  })
})
