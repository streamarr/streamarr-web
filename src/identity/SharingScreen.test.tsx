import { screen, waitFor } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { HOUSEHOLD_ID, meFixture, PROFILE_ID, profileFixture } from '../test/meFixture'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { SharingScreen } from './SharingScreen'

const OFFER_ID = '77777777-7777-7777-7777-777777777777'
const OTHER_HOUSEHOLD_ID = '55555555-5555-5555-5555-555555555555'

function serverAnswersOverview(overrides: { offers?: unknown[]; shares?: unknown[] } = {}) {
  server.use(
    graphql.query('Me', () =>
      HttpResponse.json({ data: { me: meFixture({ profiles: [profileFixture()] }) } }),
    ),
    graphql.query('SharingOverview', () =>
      HttpResponse.json({
        data: {
          pendingShareOffers: {
            __typename: 'ProfileShareConnection',
            edges: (overrides.offers ?? []).map((node) => ({
              __typename: 'ProfileShareEdge',
              node,
            })),
          },
          profileShares: {
            __typename: 'ProfileShareConnection',
            edges: (overrides.shares ?? []).map((node) => ({
              __typename: 'ProfileShareEdge',
              node,
            })),
          },
        },
      }),
    ),
  )
}

function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'ProfileShare',
    id: OFFER_ID,
    profileId: PROFILE_ID,
    householdId: OTHER_HOUSEHOLD_ID,
    status: 'PENDING',
    requiredByAccountMembership: false,
    expiresAt: '2026-08-27T12:00:00Z',
    ...overrides,
  }
}

describe('SharingScreen', () => {
  it('shouldAcceptAPendingOfferIntoTheContextHousehold', async () => {
    serverAnswersOverview({ offers: [shareRow()] })
    let accepted = false
    server.use(
      graphql.mutation('AcceptProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: OFFER_ID } })
        accepted = true
        return HttpResponse.json({
          data: {
            acceptProfileShare: {
              __typename: 'AcceptProfileSharePayload',
              share: { __typename: 'ProfileShare', id: OFFER_ID, status: 'ACTIVE' },
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(accepted).toBe(true))
  })

  it('shouldRenderTypedRefusalsThroughTheMessageFallback', async () => {
    serverAnswersOverview()
    server.use(
      graphql.query('ProfileSharePreview', () =>
        HttpResponse.json({
          data: {
            profileSharePreview: {
              __typename: 'ProfileSharePreview',
              wouldLock: true,
              nameConflict: false,
            },
          },
        }),
      ),
      graphql.mutation('OfferProfileShare', () =>
        HttpResponse.json({
          data: {
            offerProfileShare: {
              __typename: 'OfferProfileSharePayload',
              share: null,
              userErrors: [
                {
                  __typename: 'ProfileAlreadySharedError',
                  message: 'That Profile already has a live share into that Household.',
                },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await screen.findByLabelText(/^household id/i), OTHER_HOUSEHOLD_ID)
    // The preview's two answers surface before anything is written.
    expect(await screen.findByText(/would arrive locked/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Offer share' }))

    expect(
      await screen.findByText('That Profile already has a live share into that Household.'),
    ).toBeInTheDocument()
  })

  it('shouldEndAnActiveShareButNeverTheHomeOne', async () => {
    serverAnswersOverview({
      shares: [
        shareRow({ id: '88888888-8888-8888-8888-888888888888', householdId: HOUSEHOLD_ID, status: 'ACTIVE', requiredByAccountMembership: true }),
        shareRow({ status: 'ACTIVE' }),
      ],
    })
    let ended = false
    server.use(
      graphql.mutation('EndProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: OFFER_ID } })
        ended = true
        return HttpResponse.json({
          data: {
            endProfileShare: {
              __typename: 'EndProfileSharePayload',
              share: { __typename: 'ProfileShare', id: OFFER_ID, status: 'ENDED' },
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    // The membership-required Home share offers no way to end it.
    expect(await screen.findByText('Home')).toBeInTheDocument()
    const endButtons = screen.getAllByRole('button', { name: 'End share' })
    expect(endButtons).toHaveLength(1)
    await user.click(endButtons[0])

    await waitFor(() => expect(ended).toBe(true))
  })
})
