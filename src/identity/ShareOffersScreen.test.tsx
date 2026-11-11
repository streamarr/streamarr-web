import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ShareOffersQuery } from '../graphql/generated/graphql'
import { focusesOf, leaveTheConfirmation, type WayOut } from '../test/focus'
import {
  answersInTurn,
  answerWith,
  comeBackOnline,
  comeBackOnlineUntil,
  heldAnswer,
  readsThatCanBeHeld,
  refusedWith,
  serverFailure,
} from '../test/graphqlResponses'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { HOUSEHOLD_ID, meFixture, PROFILE_ID } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import {
  leaveForHome,
  leaveForHomeAndReturn,
  openFromTheProfileMenu,
  returnThroughTheProfileMenu,
  type SettingsPage,
} from '../test/returnVisits'
import { server } from '../test/server'
import {
  followingShareChanges,
  HIDDEN_ONCE_OVER,
  IN_A_WEEK,
  liveShare,
  shareChanged,
} from '../test/shareChangeFixtures'

type OfferFields = ShareOffersQuery['householdShares']['edges'][number]['node']
type OfferedProfile = NonNullable<OfferFields['profile']> & { __typename: 'ProfileSummary' }
type OfferNode = Omit<OfferFields, 'profile'> & {
  __typename: 'ProfileShare'
  profile: OfferedProfile | null
}

const OFFERS = '/settings/household/offers'
const SHARE_OFFERS: SettingsPage = { area: 'Household settings', heading: 'Share invitations' }
const OFFER_ID = '77777777-7777-7777-7777-777777777777'
const CABIN_ID = '55555555-5555-5555-5555-555555555555'
const HOUR = 60 * 60 * 1000

function offeredProfile(overrides: Partial<OfferedProfile> = {}): OfferedProfile {
  return {
    __typename: 'ProfileSummary',
    id: PROFILE_ID,
    name: 'Alex',
    picture: null,
    kind: 'ADULT',
    personalProfile: false,
    restricted: false,
    ...overrides,
  }
}

function offer(overrides: Partial<OfferNode> = {}): OfferNode {
  return {
    __typename: 'ProfileShare',
    id: OFFER_ID,
    profileId: PROFILE_ID,
    householdId: HOUSEHOLD_ID,
    status: 'PENDING',
    // A week ahead, since the server lists an offer as waiting only before its expiry.
    expiresAt: IN_A_WEEK,
    profile: offeredProfile(),
    offeredByDisplayName: 'Sam',
    visitor: true,
    ...overrides,
  }
}

function offersData(offers: OfferNode[] = []) {
  return {
    householdShares: {
      __typename: 'ProfileShareConnection',
      edges: offers.map((node) => ({ __typename: 'ProfileShareEdge', node })),
    },
  }
}

function serve(offers: OfferNode[] = [], me = meFixture()) {
  const socket = serveGraphqlSocket()
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('ShareOffers', ({ variables }) => {
      expect(variables).toEqual({ householdId: HOUSEHOLD_ID })
      return HttpResponse.json({ data: offersData(offers) })
    }),
  )
  return socket
}

// The offers the server holds at each read, and whether it fails to read them: a test changes
// them where the server would. The page reads them again once it follows share changes, so no test
// counts on how often it reads.
function serveOffers(offers: OfferNode[]) {
  const held = { offers, reads: 0, failing: false }
  serve()
  server.use(
    graphql.query('ShareOffers', () => {
      held.reads += 1
      if (held.failing) return serverFailure()
      return HttpResponse.json({ data: offersData(held.offers) })
    }),
  )
  return held
}

// Opens Household settings a second time, with `account` as the server's answer to the access
// check. The first arrival also confirms the session, and a failure there never reaches the check.
async function returnToHouseholdSettings(account: () => Response | Promise<Response>) {
  serve()
  const { user } = renderAppAt(OFFERS)
  await screen.findByRole('heading', { level: 1, name: 'Share invitations' })
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

function refusedAcceptance(error: { __typename: string; message: string }) {
  return { __typename: 'AcceptProfileSharePayload', share: null, userErrors: [error] }
}

const NAME_IN_USE = {
  __typename: 'ShareNameConflictError',
  message: 'Another Profile in that Household already uses this name.',
}

function refuseToAccept() {
  server.use(
    graphql.mutation('AcceptProfileShare', () =>
      HttpResponse.json({ data: { acceptProfileShare: refusedAcceptance(NAME_IN_USE) } }),
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

function notPendingPayload() {
  return {
    __typename: 'RejectProfileSharePayload',
    share: null,
    userErrors: [{ __typename: 'ShareNotPendingError', message: 'That offer is not pending.' }],
  }
}

function refuseToDecline() {
  server.use(
    graphql.mutation('RejectProfileShare', () =>
      HttpResponse.json({ data: { rejectProfileShare: notPendingPayload() } }),
    ),
  )
}

describe('Household settings', () => {
  it('shouldOpenShareOffersAsTheFirstSectionWhenAHouseholdAdminOpensHouseholdSettings', async () => {
    serve()
    const { router } = renderAppAt('/settings/household')

    const menu = await screen.findByRole('navigation', { name: 'Household settings' })
    expect(within(menu).getByRole('link', { name: 'Share invitations' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      await within(screen.getByRole('region', { name: 'Share invitations' })).findByRole(
        'heading',
        {
          level: 1,
          name: 'Share invitations',
        },
      ),
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

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Share invitations' }),
    ).toBeVisible()
  })

  it('shouldShowTheServersWordsWhenTheServerRefusesTheAccessCheck', async () => {
    await returnToHouseholdSettings(() => refusedWith('This session may not read its account.'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^This session may not read its account\.$/,
    )
  })
})

describe('Share invitations', () => {
  it('shouldSayNoShareInvitationsAreWaitingWhenTheHouseholdHasNone', async () => {
    serve()
    renderAppAt(OFFERS)

    expect(
      await screen.findByText('No share invitations are waiting for Smith Family.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Accept/ })).not.toBeInTheDocument()
  })

  it('shouldListEachOfferUnderTheHouseholdsNameWhenOffersWait', async () => {
    serve([offer()])
    renderAppAt(OFFERS)

    const offered = await screen.findByRole('region', {
      name: 'Share invitations for Smith Family',
    })
    expect(within(offered).getAllByRole('listitem')).toHaveLength(1)
    expect(within(offered).getByRole('button', { name: 'Accept Alex' })).toBeEnabled()
  })

  it('shouldReadTheOffersOfTheAccountsOwnHouseholdWhenTheSessionUsesAnother', async () => {
    serve([offer()], meFixture({ contextHouseholdId: CABIN_ID, contextHouseholdName: 'Cabin' }))
    renderAppAt(OFFERS)

    expect(
      await screen.findByRole('region', { name: 'Share invitations for Smith Family' }),
    ).toBeVisible()
  })

  it('shouldListAnOfferThatArrivedWhileTheAdminWasAwayWhenTheyReturn', async () => {
    const held = serveOffers([])
    const { user } = renderAppAt(OFFERS)
    await screen.findByText('No share invitations are waiting for Smith Family.')

    await leaveForHome(user, SHARE_OFFERS)
    held.offers = [offer()]
    await returnThroughTheProfileMenu(user, SHARE_OFFERS)

    expect(await screen.findByRole('button', { name: 'Accept Alex' })).toBeEnabled()
  })

  it('shouldDropAnOfferTheServerNoLongerListsWhenTheAdminReturns', async () => {
    const held = serveOffers([offer()])
    const { user } = renderAppAt(OFFERS)
    await screen.findByRole('button', { name: 'Accept Alex' })

    await leaveForHome(user, SHARE_OFFERS)
    held.offers = []
    await returnThroughTheProfileMenu(user, SHARE_OFFERS)

    expect(
      await screen.findByText('No share invitations are waiting for Smith Family.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Accept/ })).not.toBeInTheDocument()
  })

  it('shouldShowTheOffersAsLoadingUntilTheServerAnswersWhenTheAdminReturns', async () => {
    serve()
    const { user } = renderAppAt(OFFERS)
    await screen.findByText('No share invitations are waiting for Smith Family.')
    server.use(graphql.query('ShareOffers', () => delay('infinite')))

    await leaveForHomeAndReturn(user, SHARE_OFFERS)

    expect(
      await screen.findByRole('status', { name: 'Loading share invitations' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No share invitations are waiting for Smith Family.'),
    ).not.toBeInTheDocument()
  })

  it('shouldSayTheOffersCouldNotLoadWhenReadingThemFailsAsTheAdminReturns', async () => {
    serve([offer()])
    const { user } = renderAppAt(OFFERS)
    await screen.findByRole('button', { name: 'Accept Alex' })
    server.use(graphql.query('ShareOffers', serverFailure))

    await leaveForHomeAndReturn(user, SHARE_OFFERS)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load share invitations.")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Accept/ })).not.toBeInTheDocument()
  })

  it('shouldKeepTheOffersOnScreenWhenReadingThemAgainFails', async () => {
    serve()
    const fresh = heldAnswer(offersData())
    const offers = answersInTurn(answerWith(offersData([offer()])), serverFailure, fresh.answer)
    server.use(graphql.query('ShareOffers', offers.resolver))
    renderAppAt(OFFERS)
    await screen.findByRole('button', { name: 'Accept Alex' })

    await comeBackOnlineUntil(offers, 3)
    expect(screen.getByRole('button', { name: 'Accept Alex' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fresh.release()

    expect(
      await screen.findByText('No share invitations are waiting for Smith Family.'),
    ).toBeInTheDocument()
  })

  it('shouldRetryWhenTheOffersFailToLoad', async () => {
    const held = serveOffers([offer()])
    held.failing = true
    const { user } = renderAppAt(OFFERS)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load share invitations.")
    const retry = screen.getByRole('button', { name: 'Retry' })

    held.failing = false
    await user.click(retry)

    expect(await screen.findByRole('button', { name: 'Accept Alex' })).toBeEnabled()
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

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))

    const dialog = screen.getByRole('dialog', { name: 'Accept Alex into Smith Family?' })
    expect(dialog).toHaveTextContent(
      /^Accept Alex into Smith Family\?Alex becomes available in Smith Family\./,
    )
    expect(dialog).not.toHaveTextContent("someone's Personal Profile")
    expect(accepted).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(accepted).toBe(false)
  })

  it.each<WayOut>(['Cancel', 'Escape'])(
    'shouldReturnFocusToAcceptWhenTheAdminLeavesItsConfirmation(%s)',
    async (way) => {
      serve([offer({ expiresAt: IN_A_WEEK })])
      const { user } = renderAppAt(OFFERS)
      const accept = await screen.findByRole('button', { name: 'Accept Alex' })
      const heading = focusesOf(
        screen.getByRole('heading', { level: 1, name: 'Share invitations' }),
      )

      await user.click(accept)
      await leaveTheConfirmation(user, way)

      await waitFor(() => expect(accept).toHaveFocus())
      expect(heading.count).toBe(0)
    },
  )

  it('shouldAcceptTheOfferAndSaySoWhenTheAdminConfirms', async () => {
    const held = serveOffers([offer()])
    server.use(
      graphql.mutation('AcceptProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: OFFER_ID } })
        held.offers = []
        return HttpResponse.json({ data: { acceptProfileShare: acceptedPayload() } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept' }))

    await noticed('Alex accepted into Smith Family.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      await screen.findByText('No share invitations are waiting for Smith Family.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Share invitations' })).toHaveFocus()
  })

  it('shouldSayTheOfferWasAcceptedWhenReadingTheOffersAgainFails', async () => {
    const held = serveOffers([offer()])
    server.use(
      graphql.mutation('AcceptProfileShare', () => {
        held.failing = true
        return HttpResponse.json({ data: { acceptProfileShare: acceptedPayload() } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept' }))

    await noticed('Alex accepted into Smith Family.')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load share invitations.")
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shouldKeepTheConfirmationOpenWithTheServersWordsWhenAcceptingIsRefused', async () => {
    serve([offer()])
    refuseToAccept()
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NAME_IN_USE.message)
    expect(within(dialog).getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  it('shouldConfirmWithTheProfilesCurrentFactsWhenTheOffersReadAfterARefusalHaveChanged', async () => {
    const held = serveOffers([offer()])
    server.use(
      graphql.mutation('AcceptProfileShare', () => {
        held.offers = [offer({ profile: offeredProfile({ name: 'Robin', restricted: true }) })]
        return HttpResponse.json({ data: { acceptProfileShare: refusedAcceptance(NAME_IN_USE) } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept' }))

    expect(
      await screen.findByRole('dialog', { name: 'Accept Robin into Smith Family?' }),
    ).toHaveTextContent(
      'Robin becomes available in Smith Family. It is restricted, so admins of Smith Family supervise it here.',
    )
  })

  it('shouldSayTheProfilesCurrentNameWhenAcceptingSucceedsAfterARefusal', async () => {
    const held = serveOffers([offer()])
    const answers = [
      {
        offers: [offer({ profile: offeredProfile({ name: 'Robin' }) })],
        payload: refusedAcceptance(NAME_IN_USE),
      },
      { offers: [], payload: acceptedPayload() },
    ]
    let readsWhenRefused = Infinity
    server.use(
      graphql.mutation('AcceptProfileShare', () => {
        const answer = answers.shift()!
        held.offers = answer.offers
        readsWhenRefused = held.reads
        return HttpResponse.json({ data: { acceptProfileShare: answer.payload } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Accept' })
    await user.click(confirm)
    await within(dialog).findByRole('alert')
    // The confirmation takes a second Accept only once the offers have been read again.
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(held.reads).toBeGreaterThan(readsWhenRefused)
    await user.click(confirm)

    await noticed('Robin accepted into Smith Family.')
  })

  it('shouldCloseTheConfirmationAndKeepTheServersWordsWhenARefusedOfferIsNoLongerListed', async () => {
    const held = serveOffers([offer()])
    server.use(
      graphql.mutation('AcceptProfileShare', () => {
        held.offers = []
        return HttpResponse.json({
          data: {
            acceptProfileShare: refusedAcceptance({
              __typename: 'ShareNotPendingError',
              message: 'That offer is not pending.',
            }),
          },
        })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept' }))

    expect(
      await screen.findByText('No share invitations are waiting for Smith Family.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('That offer is not pending.')
  })

  it('shouldTakeTheServersWordsAwayWhenTheAdminClosesTheConfirmation', async () => {
    serve([offer()])
    refuseToAccept()
    const { user } = renderAppAt(OFFERS)
    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NAME_IN_USE.message)
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled(),
    )

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldReopenTheConfirmationWithTheServersWordsWhenRetryBringsTheOffersBackAfterARefusedAccept', async () => {
    const held = serveOffers([offer()])
    server.use(
      graphql.mutation('AcceptProfileShare', () => {
        held.failing = true
        return HttpResponse.json({ data: { acceptProfileShare: refusedAcceptance(NAME_IN_USE) } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText("Couldn't load share invitations.")).toBeVisible()

    held.failing = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Accept Alex into Smith Family?',
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(NAME_IN_USE.message)
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

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
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

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^Couldn't update sharing\.$/,
    )
  })

  it('shouldDeclineAnOfferAtOnceAndSaySo', async () => {
    const held = serveOffers([offer()])
    let declined = false
    server.use(
      graphql.mutation('RejectProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: OFFER_ID } })
        declined = true
        held.offers = []
        return HttpResponse.json({ data: { rejectProfileShare: declinedPayload() } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Alex' }))

    await noticed('Share invitation for Alex declined.')
    expect(declined).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
  })

  it('shouldShowTheServersWordsAndReadTheOffersAgainWhenDecliningIsRefused', async () => {
    const held = serveOffers([offer()])
    let readsWhenRefused = Infinity
    server.use(
      graphql.mutation('RejectProfileShare', () => {
        readsWhenRefused = held.reads
        return HttpResponse.json({ data: { rejectProfileShare: notPendingPayload() } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Alex' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() => expect(held.reads).toBeGreaterThan(readsWhenRefused))
  })

  it('shouldNotSayTheOfferWasDeclinedWhenDecliningIsRefused', async () => {
    serve([offer()])
    refuseToDecline()
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Alex' }))

    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Decline Alex' })).toBeEnabled())
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('shouldSayTheOfferWasDeclinedWhenReadingTheOffersAgainFails', async () => {
    const held = serveOffers([offer()])
    server.use(
      graphql.mutation('RejectProfileShare', () => {
        held.failing = true
        return HttpResponse.json({ data: { rejectProfileShare: declinedPayload() } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Alex' }))

    await noticed('Share invitation for Alex declined.')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load share invitations.")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Decline/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Share invitations' })).toHaveFocus()
  })

  it('shouldShowTheServersWordsAgainWhenRetryBringsTheOffersBackAfterARefusedDecline', async () => {
    const held = serveOffers([offer()])
    server.use(
      graphql.mutation('RejectProfileShare', () => {
        held.failing = true
        return HttpResponse.json({ data: { rejectProfileShare: notPendingPayload() } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Alex' }))
    expect(await screen.findByText("Couldn't load share invitations.")).toBeVisible()

    held.failing = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('button', { name: 'Decline Alex' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('That offer is not pending.')
  })

  it('shouldTakeTheServersWordsAwayWhenTheNextDeclineIsTaken', async () => {
    const held = serveOffers([offer()])
    refuseToDecline()
    const { user } = renderAppAt(OFFERS)
    await user.click(await screen.findByRole('button', { name: 'Decline Alex' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Decline Alex' })).toBeEnabled())

    server.use(
      graphql.mutation('RejectProfileShare', () => {
        held.offers = []
        return HttpResponse.json({ data: { rejectProfileShare: declinedPayload() } })
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Decline Alex' }))

    await noticed('Share invitation for Alex declined.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldOpenTheConfirmationWithoutAnEarlierRefusalWhenTheAdminAsksToAccept', async () => {
    serve([offer()])
    refuseToDecline()
    const { user } = renderAppAt(OFFERS)
    await user.click(await screen.findByRole('button', { name: 'Decline Alex' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept Alex' })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: 'Accept Alex' }))

    expect(screen.getByRole('dialog', { name: 'Accept Alex into Smith Family?' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldSayAcceptingAdmitsThePersonWhenTheOfferIsSomeonesPersonalProfile', async () => {
    serve([offer({ profile: offeredProfile({ personalProfile: true }) })])
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))

    expect(
      screen.getByRole('dialog', { name: 'Accept Alex into Smith Family?' }),
    ).toHaveTextContent(
      "This is someone's Personal Profile. Accepting admits that person to Smith Family: they can select any Profile available here, browse its libraries and link a TV to it.",
    )
  })

  it.each([
    [false, 'Alex becomes available in Smith Family.'],
    [
      true,
      "This is someone's Personal Profile. Accepting admits that person to Smith Family: they can select any Profile available here, browse its libraries and link a TV to it.",
    ],
  ])(
    'shouldSayAdminsHereSuperviseARestrictedProfileBeforeItIsAccepted(personal: %s)',
    async (personalProfile, before) => {
      serve([offer({ profile: offeredProfile({ personalProfile, restricted: true }) })])
      const { user } = renderAppAt(OFFERS)

      await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))

      expect(screen.getByRole('dialog')).toHaveTextContent(
        `${before} It is restricted, so admins of Smith Family supervise it here.`,
      )
    },
  )

  it('shouldShowWhoOfferedEachProfileAndWhatItIs', async () => {
    serve([offer({ profile: offeredProfile({ personalProfile: true, restricted: true }) })])
    renderAppAt(OFFERS)

    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('Alex')).toBeVisible()
    expect(within(row).getByText('Offered by Sam')).toBeVisible()
    expect(within(row).getByText('Personal Profile')).toBeVisible()
    expect(within(row).getByText('Restricted')).toBeVisible()
  })

  it('shouldSayOnlyWhatIsTrueOfAnOfferWhenTheServerNamesNoOfferer', async () => {
    serve([offer({ offeredByDisplayName: null })])
    renderAppAt(OFFERS)

    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('Alex')).toBeVisible()
    expect(within(row).queryByText(/^Offered by/)).not.toBeInTheDocument()
    expect(within(row).queryByText('Personal Profile')).not.toBeInTheDocument()
    expect(within(row).queryByText('Restricted')).not.toBeInTheDocument()
  })

  it('shouldLeaveOutAnOfferThatCarriesNoProfile', async () => {
    serve([
      offer({ id: '88888888-8888-8888-8888-888888888888', profile: null }),
      offer({ profile: offeredProfile({ name: 'Sam' }) }),
    ])
    renderAppAt(OFFERS)

    const offered = await screen.findByRole('region', {
      name: 'Share invitations for Smith Family',
    })
    expect(within(offered).getAllByRole('listitem')).toHaveLength(1)
    expect(within(offered).getByRole('button', { name: 'Accept Sam' })).toBeEnabled()
  })

  it('shouldTakeOutAnOfferWhenItsTimeRunsOutWithThePageOpen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
    onTestFinished(() => void vi.useRealTimers())
    serve([
      offer({ expiresAt: new Date(Date.now() + HOUR).toISOString() }),
      offer({
        id: 'mara',
        profileId: 'mara',
        expiresAt: new Date(Date.now() + 2 * HOUR).toISOString(),
        profile: offeredProfile({ id: 'mara', name: 'Mara' }),
      }),
    ])
    renderAppAt(OFFERS)
    await screen.findByRole('button', { name: 'Accept Alex' })

    await act(() => vi.advanceTimersByTimeAsync(HOUR))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Accept Alex' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Accept Mara' })).toBeEnabled()

    await act(() => vi.advanceTimersByTimeAsync(HOUR))

    expect(
      await screen.findByText('No share invitations are waiting for Smith Family.'),
    ).toBeVisible()
  })

  it('shouldSayHowLongAnOfferHasLeftWhenItIsListed', async () => {
    const inSixDays = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)
    serve([offer({ expiresAt: inSixDays.toISOString() })])
    renderAppAt(OFFERS)

    expect(await screen.findByText('Expires in 6 days')).toBeInTheDocument()
  })

  it('shouldSayTheShareInvitationsCouldNotLoadAndReadThemAgainOnRetry', async () => {
    const held = serveOffers([])
    held.failing = true
    const { user } = renderAppAt(OFFERS)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load share invitations.")
    const retry = screen.getByRole('button', { name: 'Retry' })

    held.failing = false
    await user.click(retry)

    expect(
      await screen.findByText('No share invitations are waiting for Smith Family.'),
    ).toBeInTheDocument()
  })
})

describe('Share offers as they change elsewhere', () => {
  const robin = liveShare({
    id: '99999999-9999-9999-9999-999999999999',
    profileId: 'robin',
    profile: offeredProfile({ id: 'robin', name: 'Robin' }),
    expiresAt: IN_A_WEEK,
  })

  async function openWithAnOfferOfAlex() {
    const socket = serve([offer({ expiresAt: IN_A_WEEK })])
    const rendered = renderAppAt(OFFERS)
    await screen.findByRole('button', { name: 'Accept Alex' })
    await followingShareChanges(socket)
    return { socket, ...rendered }
  }

  function offeredNames() {
    return screen
      .getAllByRole('button', { name: /^Accept / })
      .map((accept) => accept.getAttribute('aria-label'))
  }

  it('shouldListFirstAnOfferThatArrivesWhileThePageIsOpen', async () => {
    const { socket } = await openWithAnOfferOfAlex()

    socket.publish('ProfileShareChanged', shareChanged(robin.id, robin))

    await waitFor(() => expect(offeredNames()).toEqual(['Accept Robin', 'Accept Alex']))
  })

  it('shouldTakeOutAnOfferWhenItIsAcceptedElsewhere', async () => {
    const { socket } = await openWithAnOfferOfAlex()

    socket.publish('ProfileShareChanged', shareChanged(OFFER_ID, liveShare({ status: 'ACTIVE' })))

    expect(
      await screen.findByText('No share invitations are waiting for Smith Family.'),
    ).toBeVisible()
  })

  it('shouldTakeOutAnOfferWhenItsOffererWithdrawsIt', async () => {
    const { socket } = await openWithAnOfferOfAlex()

    socket.publish(
      'ProfileShareChanged',
      shareChanged(OFFER_ID, liveShare({ status: 'CANCELED', ...HIDDEN_ONCE_OVER })),
    )

    expect(
      await screen.findByText('No share invitations are waiting for Smith Family.'),
    ).toBeVisible()
  })

  it('shouldLeaveOutAnOfferToAnotherHouseholdWhenItsChangeArrives', async () => {
    const { socket } = await openWithAnOfferOfAlex()

    socket.publish(
      'ProfileShareChanged',
      shareChanged('elsewhere', liveShare({ id: 'elsewhere', householdId: 'cabin' })),
    )
    socket.publish('ProfileShareChanged', shareChanged(robin.id, robin))

    await waitFor(() => expect(offeredNames()).toEqual(['Accept Robin', 'Accept Alex']))
  })

  it('shouldKeepFocusWhereThePersonIsWhenAnOfferArrives', async () => {
    const { socket } = await openWithAnOfferOfAlex()
    const decline = screen.getByRole('button', { name: 'Decline Alex' })
    act(() => decline.focus())

    socket.publish('ProfileShareChanged', shareChanged(robin.id, robin))

    await screen.findByRole('button', { name: 'Accept Robin' })
    expect(decline).toHaveFocus()
  })

  it('shouldMoveFocusToTheHeadingWhenTheOfferThePersonIsOnLeaves', async () => {
    const { socket } = await openWithAnOfferOfAlex()
    act(() => screen.getByRole('button', { name: 'Accept Alex' }).focus())

    socket.publish('ProfileShareChanged', shareChanged(OFFER_ID, liveShare({ status: 'ACTIVE' })))

    await screen.findByText('No share invitations are waiting for Smith Family.')
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Share invitations' })).toHaveFocus(),
    )
  })

  describe('while a read of the offers is on its way', () => {
    const mara = offer({
      id: 'mara',
      profileId: 'mara',
      expiresAt: IN_A_WEEK,
      profile: offeredProfile({ id: 'mara', name: 'Mara' }),
    })
    const leo = liveShare({
      id: 'leo',
      profileId: 'leo',
      profile: offeredProfile({ id: 'leo', name: 'Leo' }),
    })

    // The offers the server holds; each read answers with them as they stood when it arrived.
    async function openWithAReadOnItsWay() {
      const held = { offers: [offer({ expiresAt: IN_A_WEEK })] }
      const socket = serve()
      const reads = readsThatCanBeHeld(() => offersData(held.offers))
      server.use(graphql.query('ShareOffers', reads.resolver))
      renderAppAt(OFFERS)
      await screen.findByRole('button', { name: 'Accept Alex' })
      await followingShareChanges(socket)
      // Mara's offer shows that the held read has answered.
      held.offers = [mara, ...held.offers]
      const read = reads.holdNext()
      comeBackOnline()
      await read.arrived
      return { held, socket, release: read.release }
    }

    it('shouldKeepAnOfferThatArrivedWhenAReadSentBeforeItAnswers', async () => {
      const { held, socket, release } = await openWithAReadOnItsWay()

      held.offers = [leo, ...held.offers]
      socket.publish('ProfileShareChanged', shareChanged(leo.id, leo))
      await screen.findByRole('button', { name: 'Accept Leo' })
      release()

      await screen.findByRole('button', { name: 'Accept Mara' })
      expect(offeredNames()).toEqual(['Accept Leo', 'Accept Mara', 'Accept Alex'])
    })

    it('shouldLeaveOutAnOfferAcceptedElsewhereWhenAReadSentBeforeTheAcceptanceAnswers', async () => {
      const { held, socket, release } = await openWithAReadOnItsWay()

      held.offers = [mara]
      socket.publish('ProfileShareChanged', shareChanged(OFFER_ID, liveShare({ status: 'ACTIVE' })))
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Accept Alex' })).not.toBeInTheDocument(),
      )
      release()

      await screen.findByRole('button', { name: 'Accept Mara' })
      expect(offeredNames()).toEqual(['Accept Mara'])
    })
  })

  it('shouldStopFollowingShareChangesWhenTheAdminLeavesThePage', async () => {
    const { socket, user } = await openWithAnOfferOfAlex()

    await leaveForHome(user, SHARE_OFFERS)

    await waitFor(() => expect(socket.isLive('ProfileShareChanged')).toBe(false))
  })
})

// The confirmation holds a status of its own while a request is on its way, so the page's notice
// is the one status only once the confirmation has closed.
async function noticed(text: string) {
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text))
}
