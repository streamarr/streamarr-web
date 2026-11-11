import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ShareOffersQuery } from '../graphql/generated/graphql'
import { focusesOf, leaveTheConfirmation, type WayOut } from '../test/focus'
import { comeBackOnline, readsThatCanBeHeld } from '../test/graphqlResponses'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { HOUSEHOLD_ID, meFixture, PROFILE_ID } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import {
  leaveForHome,
  leaveForHomeAndReturn,
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
const SHARE_OFFERS: SettingsPage = { area: 'Household settings', heading: 'Share offers' }
const OFFER_ID = '77777777-7777-7777-7777-777777777777'
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

function offersData(offers: OfferNode[]) {
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

// The offers the server holds at each read: a test changes them where the server would. The
// page reads them again once it follows share changes, so no test counts on how often it reads.
function serveOffers(offers: OfferNode[]) {
  const held = { offers, reads: 0 }
  serve()
  server.use(
    graphql.query('ShareOffers', () => {
      held.reads += 1
      return HttpResponse.json({ data: offersData(held.offers) })
    }),
  )
  return held
}

function declinedPayload() {
  return {
    __typename: 'RejectProfileSharePayload',
    share: { __typename: 'ProfileShare', id: OFFER_ID, status: 'REJECTED' },
    userErrors: [],
  }
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
    expect(within(offered).getByRole('button', { name: 'Accept Alex' })).toBeEnabled()
  })

  it('shouldListAnOfferThatArrivedWhileTheAdminWasAwayWhenTheyReturn', async () => {
    const held = serveOffers([])
    const { user } = renderAppAt(OFFERS)
    await screen.findByText('No one has offered a Profile to Smith Family.')

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
      const heading = focusesOf(screen.getByRole('heading', { level: 1, name: 'Share offers' }))

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
      await screen.findByText('No one has offered a Profile to Smith Family.'),
    ).toBeInTheDocument()
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

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Accept' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Another Profile in that Household already uses this name.',
    )
    expect(within(dialog).getByRole('button', { name: 'Accept' })).toBeEnabled()
  })

  it('shouldSayTheServersWordsWhenAcceptingIsRefusedAndTheOfferLeavesTheList', async () => {
    const held = serveOffers([offer()])
    server.use(
      graphql.mutation('AcceptProfileShare', () => {
        held.offers = []
        return HttpResponse.json({
          data: {
            acceptProfileShare: {
              __typename: 'AcceptProfileSharePayload',
              share: null,
              userErrors: [
                { __typename: 'ShareNotPendingError', message: 'That offer is not pending.' },
              ],
            },
          },
        })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Accept Alex' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await noticed('That offer is not pending.')
    expect(screen.getByRole('status')).not.toHaveTextContent('That offer is no longer waiting.')
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

  it('shouldSayWhatDecliningLosesBeforeItDeclinesWhenTheAdminDeclinesAnOffer', async () => {
    serve([offer()])
    let declined = false
    server.use(
      graphql.mutation('RejectProfileShare', () => {
        declined = true
        return HttpResponse.json({ data: { rejectProfileShare: declinedPayload() } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Alex' }))

    const dialog = screen.getByRole('dialog', { name: 'Decline Alex?' })
    expect(dialog).toHaveTextContent(
      /^Decline Alex\?Whoever offered Alex needs a new share code from Smith Family to offer again\./,
    )
    expect(declined).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(declined).toBe(false)
  })

  it.each<WayOut>(['Cancel', 'Escape'])(
    'shouldReturnFocusToDeclineWhenTheAdminLeavesItsConfirmation(%s)',
    async (way) => {
      serve([offer()])
      const { user } = renderAppAt(OFFERS)
      const decline = await screen.findByRole('button', { name: 'Decline Alex' })
      const heading = focusesOf(screen.getByRole('heading', { level: 1, name: 'Share offers' }))

      await user.click(decline)
      await leaveTheConfirmation(user, way)

      await waitFor(() => expect(decline).toHaveFocus())
      expect(heading.count).toBe(0)
    },
  )

  it('shouldDeclineTheOfferAndSaySoWhenTheAdminConfirms', async () => {
    const held = serveOffers([offer()])
    server.use(
      graphql.mutation('RejectProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: OFFER_ID } })
        held.offers = []
        return HttpResponse.json({ data: { rejectProfileShare: declinedPayload() } })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Alex' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Decline' }))

    await noticed('Offer of Alex declined.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      await screen.findByText('No one has offered a Profile to Smith Family.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Share offers' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
  })

  it('shouldKeepTheConfirmationOpenWithTheServersWordsAndReadTheOffersAgainWhenDecliningIsRefused', async () => {
    const held = serveOffers([offer()])
    let readsWhenRefused = Infinity
    server.use(
      graphql.mutation('RejectProfileShare', () => {
        readsWhenRefused = held.reads
        return HttpResponse.json({
          data: {
            rejectProfileShare: {
              __typename: 'RejectProfileSharePayload',
              share: null,
              userErrors: [
                { __typename: 'ShareNotPendingError', message: 'That offer is not pending.' },
              ],
            },
          },
        })
      }),
    )
    const { user } = renderAppAt(OFFERS)

    await user.click(await screen.findByRole('button', { name: 'Decline Alex' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^That offer is not pending\.$/,
    )
    await waitFor(() => expect(held.reads).toBeGreaterThan(readsWhenRefused))
    expect(within(dialog).getByRole('button', { name: 'Decline' })).toBeEnabled()
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

  it('shouldShowWhoOfferedEachProfileAndWhatItIsWhenOffersAreWaiting', async () => {
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

  it('shouldLeaveAnOfferOutWhenItCarriesNoProfile', async () => {
    serve([
      offer({ id: '88888888-8888-8888-8888-888888888888', profile: null }),
      offer({ profile: offeredProfile({ name: 'Sam' }) }),
    ])
    renderAppAt(OFFERS)

    const offered = await screen.findByRole('region', { name: 'Profiles offered to Smith Family' })
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

    expect(await screen.findByText('No one has offered a Profile to Smith Family.')).toBeVisible()
  })

  it('shouldSayHowLongAnOfferHasLeftWhenItIsListed', async () => {
    const inSixDays = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)
    serve([offer({ expiresAt: inSixDays.toISOString() })])
    renderAppAt(OFFERS)

    expect(await screen.findByText('Expires in 6 days')).toBeInTheDocument()
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

  // The colour of the mark, its initials, beside a Profile's name in its row.
  function markColour(name: string, initials: string) {
    const row = screen
      .getAllByRole('listitem')
      .find((item) => within(item).queryByText(name, { exact: true }))
    expect(row).toBeDefined()
    return within(row!).getByText(initials).style.background
  }

  function offeredNames() {
    return screen
      .getAllByRole('button', { name: /^Accept / })
      .map((accept) => accept.getAttribute('aria-label'))
  }

  it('shouldListAnOfferFirstWhenItArrivesWhileThePageIsOpen', async () => {
    const { socket } = await openWithAnOfferOfAlex()

    socket.publish('ProfileShareChanged', shareChanged(robin.id, robin))

    await waitFor(() => expect(offeredNames()).toEqual(['Accept Robin', 'Accept Alex']))
  })

  it('shouldKeepEachProfilesColourWhenAnOfferArrivesAboveIt', async () => {
    const { socket } = await openWithAnOfferOfAlex()
    const before = markColour('Alex', 'AL')

    socket.publish('ProfileShareChanged', shareChanged(robin.id, robin))

    await waitFor(() => expect(offeredNames()).toEqual(['Accept Robin', 'Accept Alex']))
    expect(markColour('Alex', 'AL')).toBe(before)
  })

  it('shouldTakeOutAnOfferWhenItIsAcceptedElsewhere', async () => {
    const { socket } = await openWithAnOfferOfAlex()

    socket.publish('ProfileShareChanged', shareChanged(OFFER_ID, liveShare({ status: 'ACTIVE' })))

    expect(await screen.findByText('No one has offered a Profile to Smith Family.')).toBeVisible()
  })

  it('shouldTakeOutAnOfferWhenItsOffererWithdrawsIt', async () => {
    const { socket } = await openWithAnOfferOfAlex()

    socket.publish(
      'ProfileShareChanged',
      shareChanged(OFFER_ID, liveShare({ status: 'CANCELED', ...HIDDEN_ONCE_OVER })),
    )

    expect(await screen.findByText('No one has offered a Profile to Smith Family.')).toBeVisible()
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

  it('shouldCloseTheConfirmationAndSaySoWhenTheOfferIsAcceptedElsewhereMeanwhile', async () => {
    const { socket, user } = await openWithAnOfferOfAlex()
    await user.click(screen.getByRole('button', { name: 'Accept Alex' }))

    socket.publish('ProfileShareChanged', shareChanged(OFFER_ID, liveShare({ status: 'ACTIVE' })))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await noticed('That offer is no longer waiting.')
    expect(screen.getByRole('heading', { level: 1, name: 'Share offers' })).toHaveFocus()
  })

  it('shouldCloseTheDeclineConfirmationAndSaySoWhenTheOfferIsWithdrawnElsewhereMeanwhile', async () => {
    const { socket, user } = await openWithAnOfferOfAlex()
    await user.click(screen.getByRole('button', { name: 'Decline Alex' }))

    socket.publish(
      'ProfileShareChanged',
      shareChanged(OFFER_ID, liveShare({ status: 'CANCELED', ...HIDDEN_ONCE_OVER })),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await noticed('That offer is no longer waiting.')
    expect(screen.getByRole('heading', { level: 1, name: 'Share offers' })).toHaveFocus()
  })

  it('shouldMoveFocusToTheHeadingWhenTheOfferThePersonIsOnLeaves', async () => {
    const { socket } = await openWithAnOfferOfAlex()
    act(() => screen.getByRole('button', { name: 'Accept Alex' }).focus())

    socket.publish('ProfileShareChanged', shareChanged(OFFER_ID, liveShare({ status: 'ACTIVE' })))

    await screen.findByText('No one has offered a Profile to Smith Family.')
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Share offers' })).toHaveFocus(),
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
