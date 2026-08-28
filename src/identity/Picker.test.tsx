import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { Picker } from './Picker'

const HOUSEHOLD_ID = '22222222-2222-2222-2222-222222222222'
const PROFILE_ID = '33333333-3333-3333-3333-333333333333'
const TOKENS = { accessTokenExpiresAt: '2026-07-08T12:10:00Z', scope: 'profile' }

const ME = {
  accountId: '11111111-1111-1111-1111-111111111111',
  email: 'owner@example.com',
  displayName: 'Owner',
  role: 'ADMIN',
  scope: 'account',
  memberships: [
    {
      householdId: HOUSEHOLD_ID,
      householdName: 'Smith Family',
      householdRole: 'OWNER',
      profiles: [
        { id: PROFILE_ID, name: 'Alex', active: false },
        { id: '44444444-4444-4444-4444-444444444444', name: 'Kids', active: false },
      ],
    },
  ],
}

describe('Picker', () => {
  it('shouldListHouseholdsAndProfilesFromMe', async () => {
    server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
    renderWithProviders(<Picker onProfileSelected={vi.fn()} />)

    expect(await screen.findByText('Smith Family')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alex' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kids' })).toBeInTheDocument()
  })

  it('shouldSelectHouseholdThenProfileWhenProfileChosen', async () => {
    server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
    const calls: string[] = []
    server.use(
      http.post('/api/auth/select-household', async ({ request }) => {
        calls.push('household')
        expect(await request.json()).toMatchObject({ householdId: HOUSEHOLD_ID })
        return HttpResponse.json({ ...TOKENS, scope: 'household' })
      }),
      http.post('/api/auth/select-profile', async ({ request }) => {
        calls.push('profile')
        expect(await request.json()).toMatchObject({ profileId: PROFILE_ID })
        return HttpResponse.json(TOKENS)
      }),
    )
    const onProfileSelected = vi.fn()
    const { user } = renderWithProviders(<Picker onProfileSelected={onProfileSelected} />)

    await user.click(await screen.findByRole('button', { name: 'Alex' }))

    // Household must be selected before the profile (scope upgrades account → household → profile).
    await waitFor(() => expect(onProfileSelected).toHaveBeenCalled())
    expect(calls).toEqual(['household', 'profile'])
  })
})
