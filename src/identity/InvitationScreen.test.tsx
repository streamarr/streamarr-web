import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { InvitationScreen } from './InvitationScreen'

const CODE = 'pub-1234.super-secret'
const PREVIEW = {
  recipientEmail: 'kai@example.com',
  householdName: 'Smith Family',
  householdRole: 'MEMBER',
  mode: 'CREATE',
  profileName: 'Kai',
  profileKind: 'ADULT',
  maximumAllowedRatingAge: null,
  expiresAt: '2026-08-27T12:00:00Z',
  remainingManagers: [],
  endingHouseholds: [],
  reofferHouseholds: [],
}
const TOKENS = { accessTokenExpiresAt: '2026-08-20T12:10:00Z', scope: 'account' }

function serverKnowsTheCode() {
  server.use(
    http.post('/api/auth/invitation/lookup', async ({ request }) => {
      expect(await request.json()).toEqual({ code: CODE })
      return HttpResponse.json(PREVIEW)
    }),
  )
}

const CONNECT_PREVIEW = {
  ...PREVIEW,
  mode: 'CONNECT',
  profileName: 'Grandpa Joe',
  remainingManagers: ['Nina'],
  endingHouseholds: ['Cabin', 'Lake House'],
  reofferHouseholds: ['Cabin'],
}

describe('InvitationScreen', () => {
  it('shouldPreviewThenCreateTheAccountFromThePastedCode', async () => {
    serverKnowsTheCode()
    server.use(
      http.post('/api/auth/invitation/accept', async ({ request }) => {
        expect(await request.json()).toMatchObject({
          code: CODE,
          displayName: 'Kai H',
          password: 'a strong passphrase',
        })
        return HttpResponse.json(TOKENS, { status: 201 })
      }),
    )
    const onAccepted = vi.fn()
    const { user } = renderWithProviders(<InvitationScreen onAccepted={onAccepted} />)

    await user.type(screen.getByLabelText(/^invitation code/i), CODE)
    await user.click(screen.getByRole('button', { name: 'Look up invitation' }))

    expect(await screen.findByText(/You're invited to Smith Family/)).toBeInTheDocument()
    expect(screen.getByText('Kai')).toBeInTheDocument()
    expect(screen.getByText(/kai@example.com/)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/^your name/i), 'Kai H')
    await user.type(screen.getByLabelText(/^choose a password/i), 'a strong passphrase')
    await user.click(screen.getByRole('button', { name: 'Create my account' }))

    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(TOKENS))
  })

  it('shouldReadEveryMissTheSameWay', async () => {
    server.use(
      http.post('/api/auth/invitation/lookup', () =>
        HttpResponse.json({ code: 'INVALID_CODE' }, { status: 404 }),
      ),
    )
    const { user } = renderWithProviders(<InvitationScreen onAccepted={vi.fn()} />)

    await user.type(screen.getByLabelText(/^invitation code/i), 'pub-9999.wrong')
    await user.click(screen.getByRole('button', { name: 'Look up invitation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That invitation isn't valid anymore",
    )
    // Back at the code field for another paste.
    expect(screen.getByLabelText(/^invitation code/i)).toBeInTheDocument()
  })


  it('shouldSpellOutWhatConnectingMeansBeforeConsent', async () => {
    server.use(
      http.post('/api/auth/invitation/lookup', () => HttpResponse.json(CONNECT_PREVIEW)),
    )
    renderWithProviders(<InvitationScreen initialCode={CODE} onAccepted={vi.fn()} />)

    expect(
      await screen.findByText(/Connecting Grandpa Joe to your new account/),
    ).toBeInTheDocument()
    expect(screen.getByText('Your existing Profile')).toBeInTheDocument()
    // Who keeps managing, which visits end, and who must consent afresh.
    expect(screen.getByText('· Nina')).toBeInTheDocument()
    expect(screen.getByText('· Lake House')).toBeInTheDocument()
    expect(screen.getByText('These Households will be offered it afresh')).toBeInTheDocument()
    // Consent is still the same ceremony: name, password, create.
    expect(screen.getByRole('button', { name: 'Create my account' })).toBeInTheDocument()
  })

  it('shouldDeclineWithoutCreatingAnything', async () => {
    serverKnowsTheCode()
    let declined = false
    server.use(
      http.post('/api/auth/invitation/decline', async ({ request }) => {
        expect(await request.json()).toEqual({ code: CODE })
        declined = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderWithProviders(
      <InvitationScreen initialCode={CODE} onAccepted={vi.fn()} />,
    )

    await user.click(await screen.findByRole('button', { name: 'Decline' }))

    expect(await screen.findByText('Invitation declined')).toBeInTheDocument()
    expect(declined).toBe(true)
  })
})
