import { screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { ShareOffersQuery } from '../graphql/generated/graphql'
import {
  answersInTurn,
  answerWith,
  comeBackOnlineUntil,
  failsOnceThen,
  heldAnswer,
  refusedWith,
  serverFailure,
} from '../test/graphqlResponses'
import { HOUSEHOLD_ID, meFixture, PROFILE_ID } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import {
  leaveForHome,
  leaveForHomeAndReturn,
  openFromTheProfileMenu,
  type SettingsPage,
} from '../test/returnVisits'
import { server } from '../test/server'

type OfferNode = ShareOffersQuery['pendingShareOffers']['edges'][number]['node'] & {
  __typename: 'ProfileShare'
}

const OFFERS = '/settings/household/offers'
const SHARE_OFFERS: SettingsPage = { area: 'Household settings', heading: 'Share offers' }
const OFFER_ID = '77777777-7777-7777-7777-777777777777'
const CABIN_ID = '55555555-5555-5555-5555-555555555555'

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

function offersData(offers: OfferNode[] = []) {
  return {
    pendingShareOffers: {
      __typename: 'ProfileShareConnection',
      edges: offers.map((node) => ({ __typename: 'ProfileShareEdge', node })),
    },
  }
}

function serve(offers: OfferNode[] = [], me = meFixture()) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('ShareOffers', ({ variables }) => {
      expect(variables).toEqual({ householdId: HOUSEHOLD_ID })
      return HttpResponse.json({ data: offersData(offers) })
    }),
  )
}

// Answers each read of the offers with the next list, and the last list from then on.
function serveInTurn(...lists: OfferNode[][]) {
  serve()
  const handler = answersInTurn(...lists.map((offers) => answerWith(offersData(offers))))
  server.use(graphql.query('ShareOffers', handler.resolver))
  return handler
}

// Answers the first read of the offers with `offers` and fails each read after it.
function serveOneReadThenFail(offers: OfferNode[]) {
  serve()
  const handler = answersInTurn(answerWith(offersData(offers)), serverFailure)
  server.use(graphql.query('ShareOffers', handler.resolver))
}

// Answers each read of the offers with `offers`, except the second, which fails.
function serveSecondReadFailing(offers: OfferNode[]) {
  serve()
  const listed = answerWith(offersData(offers))
  const handler = answersInTurn(listed, serverFailure, listed)
  server.use(graphql.query('ShareOffers', handler.resolver))
}

// Opens Household settings a second time, with `account` as the server's answer to the access
// check. The first arrival also confirms the session, and a failure there never reaches the check.
async function returnToHouseholdSettings(account: () => Response | Promise<Response>) {
  serve()
  const { user } = renderAppAt(OFFERS)
  await screen.findByRole('heading', { level: 1, name: 'Share offers' })
  await leaveForHome(user, SHARE_OFFERS)
  server.use(graphql.query('Me', account))
  await openFromTheProfileMenu(user, SHARE_OFFERS.area)
  return user
}

function acceptedPayload() {
  return {
    __typename: 'AcceptProfileSharePayload',
    share: { __typename: 'ProfileShare', id: OFFER_ID, status: 'ACTIVE' },
    userErrors: [],
  }
}

function refuseToAccept() {
  server.use(
    graphql.mutation('AcceptProfileShare', () =>
      HttpResponse.json({
        data: {
          acceptProfileShare: {
            __typename: 'AcceptProfileSharePayload',
            share: null,
            userErrors: [
              { __typename: 'ShareNameConflictError', message: 'That name is already in use.' },
            ],
          },
        },
      }),
    ),
  )
}

function declinedPayload() {
  return {
    __typename: 'RejectProfileSharePayload',
    share: { __typename: 'ProfileShare', id: OFFER_ID, status: 'REJECTED' },
    userErrors: [],
  }
}

function refuseToDecline() {
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

  it('shouldShowNoSectionUntilTheServerConfirmsAccessAgainWhenTheAdminReturns', async () => {
    const demoted = heldAnswer({ me: meFixture({ householdRole: 'MEMBER' }) })
    await returnToHouseholdSettings(demoted.answer)

    expect(
      await screen.findByRole('status', { name: 'Checking Household settings access' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Household settings' })).not.toBeInTheDocument()
    demoted.release()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Household settings are available to Household admins using an account session.',
    )
    expect(screen.queryByRole('navigation', { name: 'Household settings' })).not.toBeInTheDocument()
  })

  it('shouldStopOfferingHouseholdSettingsOnceTheServerSaysTheAccountIsNoAdmin', async () => {
    const demoted = answerWith({ me: meFixture({ householdRole: 'MEMBER' }) })
    const user = await returnToHouseholdSettings(demoted)
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /^Profile menu/ }))

    expect(await screen.findByTestId('profile-menu')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Household settings' })).not.toBeInTheDocument()
  })

  it('shouldRetryWhenAccessToHouseholdSettingsCannotBeConfirmed', async () => {
    const user = await returnToHouseholdSettings(serverFailure)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't confirm your access to Household settings.",
    )

    serve()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Share offers' })).toBeVisible()
  })

  it('shouldShowTheServersWordsWhenTheServerRefusesTheAccessCheck', async () => {
    await returnToHouseholdSettings(() => refusedWith('This session may not read its account.'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^This session may not read its account\.$/,
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

  it('shouldReadTheOffersOfTheAccountsOwnHouseholdWhenTheSessionUsesAnother', async () => {
    serve([offer()], meFixture({ contextHouseholdId: CABIN_ID, contextHouseholdName: 'Cabin' }))
    renderAppAt(OFFERS)

    expect(
      await screen.findByRole('region', { name: 'Profiles offered to Smith Family' }),
    ).toBeVisible()
  })

  it('shouldListAnOfferThatArrivedWhileTheAdminWasAwayWhenTheyReturn', async () => {
    serveInTurn([], [offer()])
    const { user } = renderAppAt(OFFERS)
    await screen.findByText('No one has offered a Profile to Smith Family.')

    await leaveForHomeAndReturn(user, SHARE_OFFERS)

    expect(await screen.findByRole('button', { name: 'Accept Profile 33333333' })).toBeEnabled()
  })

  it('shouldDropAnOfferTheServerNoLongerListsWhenTheAdminReturns', async () => {
    serveInTurn([offer()], [])
    const { user } = renderAppAt(OFFERS)
    await screen.findByRole('button', { name: 'Accept Profile 33333333' })

    await leaveForHomeAndReturn(user, SHARE_OFFERS)

    expect(
      await screen.findByText('No one has offered a Profile to Smith Family.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Accept/ })).not.toBeInTheDocument()
  })

  it('shouldShowTheOffersAsLoadingUntilTheServerAnswersWhenTheAdminReturns', async () => {
    serve()
    const { user } = renderAppAt(OFFERS)
    await screen.findByText('No one has offered a Profile to Smith Family.')
    server.use(graphql.query('ShareOffers', () => delay('infinite')))

    await leaveForHomeAndReturn(user, SHARE_OFFERS)

    expect(await screen.findByRole('status', { name: 'Loading share offers' })).toBeInTheDocument()
    expect(
      screen.queryByText('No one has offered a Profile to Smith Family.'),
    ).not.toBeInTheDocument()
  })

  it('shouldSayTheOffersCouldNotLoadWhenReadingThemFailsAsTheAdminReturns', async () => {
    serve([offer()])
    const { user } = renderAppAt(OFFERS)
    await screen.findByRole('button', { name: 'Accept Profile 33333333' })
    server.use(graphql.query('ShareOffers', serverFailure))

    await leaveForHomeAndReturn(user, SHARE_OFFERS)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load share offers.")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Accept/ })).not.toBeInTheDocument()
  })

  it('shouldKeepTheOffersOnScreenWhenReadingThemAgainFails', async () => {
    serve()
    const fresh = heldAnswer(offersData())
    const offers = answersInTurn(answerWith(offersData([offer()])), serverFailure, fresh.answer)
    server.use(graphql.query('ShareOffers', offers.resolver))
    renderAppAt(OFFERS)
    await screen.findByRole('button', { name: 'Accept Profile 33333333' })

    await comeBackOnlineUntil(offers, 3)
    expect(screen.getByRole('button', { name: 'Accept Profile 33333333' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fresh.release()

    expect(
      await screen.findByText('No one has offered a Profile to Smith Family.'),
    ).toBeInTheDocument()
  })

  it('shouldRetryWhenTheOffersFailToLoad', async () => {
    serve()
    const offers = failsOnceThen(offersData([offer()]))
    server.use(graphql.query('ShareOffers', offers.resolver))
    const { user } = renderAppAt(OFFERS)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load share offers.")

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('button', { name: 'Accept Profile 33333333' })).toBeEnabled()
    expect(offers.calls).toBe(2)
  })

  it('shouldShowTheServersWordsWhenTheServerRefusesToListTheOffers', async () => {
    serve()
    server.use(
      graphql.query('ShareOffers', () =>
        refusedWith('You may not see the offers to Smith Family.'),
      ),
    )
    renderAppAt(OFFERS)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^You may not see the offers to Smith Family\.$/,
    )
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

  it('shouldSayTheOfferWasAcceptedWhenReadingTheOffersAgainFails', async () => {
    serveOneReadThenFail([offer()])
    server.use(
      graphql.mutation('AcceptProfileShare', () =>
        HttpResponse.json({ data: { acceptProfileShare: acceptedPayload() } }),
      ),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Profile 33333333' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept' }))

    await noticed('Profile 33333333 accepted into Smith Family.')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load share offers.")
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shouldKeepTheConfirmationOpenWithTheServersWordsWhenAcceptingIsRefused', async () => {
    serve([offer()])
    refuseToAccept()
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Profile 33333333' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That name is already in use.',
    )
    expect(within(dialog).getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  it('shouldTakeTheServersWordsAwayWhenTheAdminClosesTheConfirmation', async () => {
    serve([offer()])
    refuseToAccept()
    const { user } = renderAppAt(OFFERS)
    await user.click(await screen.findByRole('button', { name: 'Accept Profile 33333333' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That name is already in use.',
    )
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled(),
    )

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldReopenTheConfirmationWithTheServersWordsWhenRetryBringsTheOffersBackAfterARefusedAccept', async () => {
    serveSecondReadFailing([offer()])
    refuseToAccept()
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Profile 33333333' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText("Couldn't load share offers.")).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Accept this Profile into Smith Family?',
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('That name is already in use.')
    expect(within(dialog).getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  it('shouldShowTheServersWordsWhenTheServerRejectsTheDecision', async () => {
    serve([offer()])
    server.use(
      graphql.mutation('AcceptProfileShare', () =>
        refusedWith('Only an admin of Smith Family may accept this offer.'),
      ),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Profile 33333333' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^Only an admin of Smith Family may accept this offer\.$/,
    )
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
        return HttpResponse.json({ data: { rejectProfileShare: declinedPayload() } })
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
    refuseToDecline()
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Profile 33333333' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() => expect(offers.calls).toBe(2))
  })

  it('shouldNotSayTheOfferWasDeclinedWhenDecliningIsRefused', async () => {
    serve([offer()])
    refuseToDecline()
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Profile 33333333' }))

    await screen.findByRole('alert')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Decline Profile 33333333' })).toBeEnabled(),
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shouldSayTheOfferWasDeclinedWhenReadingTheOffersAgainFails', async () => {
    serveOneReadThenFail([offer()])
    server.use(
      graphql.mutation('RejectProfileShare', () =>
        HttpResponse.json({ data: { rejectProfileShare: declinedPayload() } }),
      ),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Profile 33333333' }))

    await noticed('Offer of Profile 33333333 declined.')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load share offers.")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Decline/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Share offers' })).toHaveFocus()
  })

  it('shouldShowTheServersWordsAgainWhenRetryBringsTheOffersBackAfterARefusedDecline', async () => {
    serveSecondReadFailing([offer()])
    refuseToDecline()
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Profile 33333333' }))
    expect(await screen.findByText("Couldn't load share offers.")).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('button', { name: 'Decline Profile 33333333' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('That offer is not pending.')
  })

  it('shouldTakeTheServersWordsAwayWhenTheNextDeclineIsTaken', async () => {
    serveInTurn([offer()], [offer()], [])
    refuseToDecline()
    const { user } = renderAppAt(OFFERS)
    await user.click(await screen.findByRole('button', { name: 'Decline Profile 33333333' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Decline Profile 33333333' })).toBeEnabled(),
    )

    server.use(
      graphql.mutation('RejectProfileShare', () =>
        HttpResponse.json({ data: { rejectProfileShare: declinedPayload() } }),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Decline Profile 33333333' }))

    await noticed('Offer of Profile 33333333 declined.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldOpenTheConfirmationWithoutAnEarlierRefusalWhenTheAdminAsksToAccept', async () => {
    serve([offer()])
    refuseToDecline()
    const { user } = renderAppAt(OFFERS)
    await user.click(await screen.findByRole('button', { name: 'Decline Profile 33333333' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Accept Profile 33333333' })).toBeEnabled(),
    )

    await user.click(screen.getByRole('button', { name: 'Accept Profile 33333333' }))

    expect(
      screen.getByRole('dialog', { name: 'Accept this Profile into Smith Family?' }),
    ).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
