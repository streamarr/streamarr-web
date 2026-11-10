import { screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { ShareOffersQuery } from '../graphql/generated/graphql'
import { HOUSEHOLD_ID, meFixture, PROFILE_ID } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

type OfferNode = ShareOffersQuery['pendingShareOffers']['edges'][number]['node'] & {
  __typename: 'ProfileShare'
}

const OFFERS = '/settings/household/offers'
const OFFER_ID = '77777777-7777-7777-7777-777777777777'

function offer(overrides: Partial<OfferNode> = {}): OfferNode {
  return {
    __typename: 'ProfileShare',
    id: OFFER_ID,
    profileId: PROFILE_ID,
    householdId: HOUSEHOLD_ID,
    status: 'PENDING',
    expiresAt: '2026-08-27T12:00:00Z',
    ...overrides,
  }
}

function serve(offers: OfferNode[] = [], me = meFixture()) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('ShareOffers', ({ variables }) => {
      expect(variables).toEqual({ householdId: HOUSEHOLD_ID })
      return HttpResponse.json({
        data: {
          pendingShareOffers: {
            __typename: 'ProfileShareConnection',
            edges: offers.map((node) => ({ __typename: 'ProfileShareEdge', node })),
          },
        },
      })
    }),
  )
}

// Answers each read of the offers with the next list, and the last list from then on.
function serveInTurn(...lists: OfferNode[][]) {
  const handler = { calls: 0 }
  serve()
  server.use(
    graphql.query('ShareOffers', () => {
      const offers = lists[Math.min(handler.calls, lists.length - 1)] ?? []
      handler.calls += 1
      return HttpResponse.json({
        data: {
          pendingShareOffers: {
            __typename: 'ProfileShareConnection',
            edges: offers.map((node) => ({ __typename: 'ProfileShareEdge', node })),
          },
        },
      })
    }),
  )
  return handler
}

function acceptedPayload() {
  return {
    __typename: 'AcceptProfileSharePayload',
    share: { __typename: 'ProfileShare', id: OFFER_ID, status: 'ACTIVE' },
    userErrors: [],
  }
}

describe('Household settings', () => {
  it('shouldOpenShareOffersAsTheFirstSectionWhenAHouseholdAdminOpensHouseholdSettings', async () => {
    serve()
    const { router } = renderAppAt('/settings/household')

    const menu = await screen.findByRole('navigation', { name: 'Household settings' })
    expect(within(menu).getByRole('link', { name: 'Share offers' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      await within(screen.getByRole('region', { name: 'Share offers' })).findByRole('heading', {
        level: 1,
        name: 'Share offers',
      }),
    ).toBeVisible()
    expect(router.state.location.pathname).toBe(OFFERS)
  })

  it('shouldSayHouseholdSettingsAreForAdminsWhenAHouseholdMemberOpensThem', async () => {
    serve([], meFixture({ householdRole: 'MEMBER' }))
    renderAppAt(OFFERS)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Household settings are available to Household admins using an account session.',
    )
    expect(screen.queryByRole('navigation', { name: 'Household settings' })).not.toBeInTheDocument()
  })

  it('shouldSayHouseholdSettingsAreForAccountSessionsWhenATvSessionOpensThem', async () => {
    serve([], meFixture({ deviceBound: true }))
    renderAppAt(OFFERS)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Household settings are available to Household admins using an account session.',
    )
  })
})

describe('Share offers', () => {
  it('shouldSayNoOneHasOfferedAProfileWhenTheHouseholdHasNoOffers', async () => {
    serve()
    renderAppAt(OFFERS)

    expect(
      await screen.findByText('No one has offered a Profile to Smith Family.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Accept/ })).not.toBeInTheDocument()
  })

  it('shouldListEachOfferUnderTheHouseholdsNameWhenOffersWait', async () => {
    serve([offer()])
    renderAppAt(OFFERS)

    const offered = await screen.findByRole('region', { name: 'Profiles offered to Smith Family' })
    expect(within(offered).getAllByRole('listitem')).toHaveLength(1)
    expect(within(offered).getByRole('button', { name: 'Accept Profile 33333333' })).toBeEnabled()
  })

  it('shouldSayWhatAcceptingMeansBeforeItAcceptsAnOffer', async () => {
    serve([offer()])
    let accepted = false
    server.use(
      graphql.mutation('AcceptProfileShare', () => {
        accepted = true
        return HttpResponse.json({ data: { acceptProfileShare: acceptedPayload() } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Profile 33333333' }))

    const dialog = screen.getByRole('dialog', { name: 'Accept this Profile into Smith Family?' })
    expect(dialog).toHaveTextContent(
      "If this is someone's Personal Profile, accepting admits that person to Smith Family.",
    )
    expect(accepted).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(accepted).toBe(false)
  })

  it('shouldAcceptTheOfferAndSaySoWhenTheAdminConfirms', async () => {
    const offers = serveInTurn([offer()], [])
    server.use(
      graphql.mutation('AcceptProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: OFFER_ID } })
        return HttpResponse.json({ data: { acceptProfileShare: acceptedPayload() } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Profile 33333333' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept' }))

    await noticed('Profile 33333333 accepted into Smith Family.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      await screen.findByText('No one has offered a Profile to Smith Family.'),
    ).toBeInTheDocument()
    expect(offers.calls).toBe(2)
    expect(screen.getByRole('heading', { level: 1, name: 'Share offers' })).toHaveFocus()
  })

  it('shouldKeepTheConfirmationOpenWithTheServersWordsWhenAcceptingIsRefused', async () => {
    serve([offer()])
    server.use(
      graphql.mutation('AcceptProfileShare', () =>
        HttpResponse.json({
          data: {
            acceptProfileShare: {
              __typename: 'AcceptProfileSharePayload',
              share: null,
              userErrors: [
                {
                  __typename: 'ShareNameConflictError',
                  message: 'Another Profile in that Household already uses this name.',
                },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Profile 33333333' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Another Profile in that Household already uses this name.',
    )
    expect(within(dialog).getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  it('shouldSayTheDecisionCouldNotBeSentWhenTheServerCannotBeReached', async () => {
    serve([offer()])
    server.use(graphql.mutation('AcceptProfileShare', () => HttpResponse.error()))
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Profile 33333333' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^Couldn't update sharing\.$/,
    )
  })

  it('shouldDeclineAnOfferAtOnceAndSaySo', async () => {
    serveInTurn([offer()], [])
    let declined = false
    server.use(
      graphql.mutation('RejectProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: OFFER_ID } })
        declined = true
        return HttpResponse.json({
          data: {
            rejectProfileShare: {
              __typename: 'RejectProfileSharePayload',
              share: { __typename: 'ProfileShare', id: OFFER_ID, status: 'REJECTED' },
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Profile 33333333' }))

    await noticed('Offer of Profile 33333333 declined.')
    expect(declined).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
  })

  it('shouldShowTheServersWordsAndReadTheOffersAgainWhenDecliningIsRefused', async () => {
    const offers = serveInTurn([offer()], [offer()])
    server.use(
      graphql.mutation('RejectProfileShare', () =>
        HttpResponse.json({
          data: {
            rejectProfileShare: {
              __typename: 'RejectProfileSharePayload',
              share: null,
              userErrors: [
                { __typename: 'ShareNotPendingError', message: 'That offer is not pending.' },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Profile 33333333' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() => expect(offers.calls).toBe(2))
  })

  it('shouldSayHowLongAnOfferHasLeftWhenItIsListed', async () => {
    const inSixDays = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)
    serve([offer({ expiresAt: inSixDays.toISOString() })])
    renderAppAt(OFFERS)

    expect(await screen.findByText('Expires in 6 days')).toBeInTheDocument()
  })
})

// The confirmation holds a status of its own while a request is on its way, so the page's notice
// is the one status only once the confirmation has closed.
async function noticed(text: string) {
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text))
}
