import { screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished } from 'vitest'
import { watchingConnection } from '../test/continueWatchingFixtures'
import {
  answersInTurn,
  comeBackOnline,
  comeBackOnlineUntil,
  heldAnswer,
  readsThatCanBeHeld,
} from '../test/graphqlResponses'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { HOUSEHOLD_ID, meFixture, type MeFixture } from '../test/meFixture'
import {
  answerNotification,
  notificationChange,
  notificationEdge,
  followingNotificationChanges,
  notificationsChanged,
  notificationsPage,
} from '../test/notificationFixtures'
import { renderAppAt } from '../test/render'
import { leaveForHome } from '../test/returnVisits'
import { server } from '../test/server'
import { followingShareChanges, liveShare, shareChanged } from '../test/shareChangeFixtures'
import {
  offer,
  OFFER_ID,
  offeredProfile,
  offersData,
  type OfferNode,
} from '../test/shareOfferFixtures'

/** Home, with nothing to show, for `me`; the unread count answers `unread`. */
function serveHome(me: MeFixture = meFixture(), unread = 0) {
  const socket = serveGraphqlSocket()
  const reads = { unread: 0 }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('Home', () =>
      HttpResponse.json({ data: { continueWatching: watchingConnection([]), libraries: [] } }),
    ),
    graphql.query('UnreadNotificationCount', () => {
      reads.unread += 1
      return HttpResponse.json({ data: { unreadNotificationCount: unread } })
    }),
  )
  return { socket, reads }
}

/** The Notifications page with no Notifications, which marks nothing read. */
function serveNotifications() {
  server.use(
    graphql.query('Notifications', () => HttpResponse.json({ data: notificationsPage([]) })),
    graphql.mutation('MarkAllNotificationsRead', () =>
      HttpResponse.json({
        data: { markAllNotificationsRead: { unreadNotificationCount: 0, userErrors: [] } },
      }),
    ),
  )
}

async function openTheProfileMenu() {
  const { user } = renderAppAt('/')
  await user.click(await screen.findByRole('button', { name: /^Profile menu/ }))
  return within(await screen.findByTestId('profile-menu'))
}

const MARA_LINE = '“Cabin” accepted the Profile “Mara”.'

describe('The unread count in the Profile menu', () => {
  it('shouldCountTheUnreadNotificationsAfterTheirEntryWhenSomeAreUnread', async () => {
    serveHome(meFixture(), 3)

    const menu = await openTheProfileMenu()

    const entry = await menu.findByRole('button', { name: 'Notifications, 3 unread' })
    expect(within(entry).getByText('3')).toBeVisible()
  })

  it('shouldShowNoCountWhenNothingIsUnread', async () => {
    const { reads } = serveHome(meFixture(), 0)

    const menu = await openTheProfileMenu()

    await waitFor(() => expect(reads.unread).toBeGreaterThan(0))
    expect(menu.getByRole('button', { name: 'Notifications' })).toHaveTextContent(/^Notifications$/)
  })

  it('shouldShow99PlusWhenMoreThan99AreUnread', async () => {
    serveHome(meFixture(), 120)

    const menu = await openTheProfileMenu()

    const entry = await menu.findByRole('button', { name: 'Notifications, 99+ unread' })
    expect(within(entry).getByText('99+')).toBeVisible()
  })

  it('shouldKeepTheCountCurrentAsNotificationsChangeOnAnyPage', async () => {
    const { socket } = serveHome(meFixture(), 3)
    const menu = await openTheProfileMenu()
    await menu.findByRole('button', { name: 'Notifications, 3 unread' })
    await followingNotificationChanges(socket)

    socket.publish('NotificationsChanged', notificationsChanged([], 5))
    await menu.findByRole('button', { name: 'Notifications, 5 unread' })
    socket.publish('NotificationsChanged', notificationsChanged([], null))
    socket.publish('NotificationsChanged', notificationsChanged([], 0))

    await menu.findByRole('button', { name: 'Notifications' })
  })

  it('shouldKeepTheLastCountWhenAChangeCannotSayIt', async () => {
    const { socket } = serveHome(meFixture(), 3)
    serveNotifications()
    const { user } = renderAppAt('/notifications')
    await screen.findByText('No notifications.')
    await followingNotificationChanges(socket)

    // The page shows Mara's news once the change has reached it.
    const mara = answerNotification({ id: 'answer-for-mara', message: MARA_LINE })
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(mara.id, notificationEdge(mara, 1))], null),
    )
    await screen.findByText(MARA_LINE)
    await user.click(screen.getByRole('button', { name: /^Profile menu/ }))

    const menu = within(await screen.findByTestId('profile-menu'))
    expect(menu.getByRole('button', { name: 'Notifications, 3 unread' })).toBeVisible()
  })

  it('shouldKeepACountThatChangedWhenAReadSentBeforeTheChangeAnswers', async () => {
    const { socket } = serveHome()
    const count = { unread: 3 }
    const reads = readsThatCanBeHeld(() => ({ unreadNotificationCount: count.unread }))
    const counted = { calls: 0 }
    server.use(
      graphql.query('UnreadNotificationCount', () => {
        counted.calls += 1
        return reads.resolver()
      }),
    )
    const menu = await openTheProfileMenu()
    await menu.findByRole('button', { name: 'Notifications, 3 unread' })
    await followingNotificationChanges(socket)
    const read = reads.holdNext()
    comeBackOnline()
    await read.arrived

    count.unread = 5
    socket.publish('NotificationsChanged', notificationsChanged([], 5))
    await menu.findByRole('button', { name: 'Notifications, 5 unread' })
    // Holding the next read keeps it from bringing 5 back on its own.
    const next = reads.holdNext()
    onTestFinished(next.release)
    const sent = counted.calls
    read.release()
    await comeBackOnlineUntil(counted, sent + 1)

    expect(menu.getByRole('button', { name: 'Notifications, 5 unread' })).toBeVisible()
  })

  it('shouldShowNoCountAndNoErrorWhenTheCountCannotBeRead', async () => {
    serveHome()
    const later = heldAnswer({ unreadNotificationCount: 2 })
    onTestFinished(later.release)
    const reads = answersInTurn(
      () => HttpResponse.json({ errors: [{ message: 'The count could not be read.' }] }),
      later.answer,
    )
    server.use(graphql.query('UnreadNotificationCount', reads.resolver))
    const menu = await openTheProfileMenu()

    // The next read goes out only once the failed one has settled.
    await comeBackOnlineUntil(reads, 2)

    expect(menu.getByRole('button', { name: 'Notifications' })).toHaveTextContent(/^Notifications$/)
    expect(within(screen.getByRole('banner')).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('The count could not be read.')).not.toBeInTheDocument()
    later.release()
    await menu.findByRole('button', { name: 'Notifications, 2 unread' })
  })

  it('shouldReadNoCountWhenTheSessionIsBoundToATV', async () => {
    const { socket, reads } = serveHome(meFixture({ deviceBound: true }), 3)

    await openTheProfileMenu()

    expect(screen.queryByRole('button', { name: /^Notifications/ })).not.toBeInTheDocument()
    expect(reads.unread).toBe(0)
    expect(socket.isLive('NotificationsChanged')).toBe(false)
  })

  it('shouldReadNoCountOnTheProfilePicker', async () => {
    const { socket, reads } = serveHome(meFixture(), 3)

    renderAppAt('/select-profile')

    await screen.findByRole('heading', { name: /who's watching\?/i })
    // The picker reads the Profiles from the same identity the count would wait for.
    await screen.findByRole('button', { name: 'Alex' })
    expect(reads.unread).toBe(0)
    expect(socket.isLive('NotificationsChanged')).toBe(false)
  })
})

describe('The count of offers waiting in the Profile menu', () => {
  const LEO_OFFER = '88888888-8888-8888-8888-888888888888'
  const LEO = '99999999-9999-9999-9999-999999999999'
  const offerOfLeo = () =>
    offer({ id: LEO_OFFER, profileId: LEO, profile: offeredProfile({ id: LEO, name: 'Leo' }) })

  // The offers the server holds at each read: a test changes them where the server would.
  function serveWaitingOffers(offers: OfferNode[]) {
    const held = { offers, reads: 0 }
    server.use(
      graphql.query('ShareOffers', ({ variables }) => {
        expect(variables).toEqual({ householdId: HOUSEHOLD_ID })
        held.reads += 1
        return HttpResponse.json({ data: offersData(held.offers) })
      }),
    )
    return held
  }

  it('shouldCountTheOffersWaitingAfterHouseholdSettingsWhenTheAdminHasSome', async () => {
    serveHome()
    serveWaitingOffers([offer(), offerOfLeo()])

    const menu = await openTheProfileMenu()

    const entry = await menu.findByRole('button', { name: 'Household settings, 2 offers waiting' })
    expect(within(entry).getByText('2')).toBeVisible()
  })

  it('shouldSayOneOfferWaitingWhenOneWaits', async () => {
    serveHome()
    serveWaitingOffers([offer()])

    const menu = await openTheProfileMenu()

    expect(
      await menu.findByRole('button', { name: 'Household settings, 1 offer waiting' }),
    ).toBeVisible()
  })

  it('shouldShowNoWaitingCountWhenNoOfferWaits', async () => {
    serveHome(meFixture(), 3)
    serveWaitingOffers([])

    const menu = await openTheProfileMenu()

    // The Notifications count shows that the counts have been read.
    await menu.findByRole('button', { name: 'Notifications, 3 unread' })
    expect(menu.getByRole('button', { name: 'Household settings' })).toHaveTextContent(
      /^Household settings$/,
    )
  })

  it('shouldKeepTheWaitingCountCurrentAsSharesChangeOnAnyPage', async () => {
    const { socket } = serveHome()
    const held = serveWaitingOffers([offer()])
    const menu = await openTheProfileMenu()
    await menu.findByRole('button', { name: 'Household settings, 1 offer waiting' })
    await followingShareChanges(socket)

    held.offers = [offerOfLeo(), offer()]
    socket.publish('ProfileShareChanged', shareChanged(LEO_OFFER, liveShare(offerOfLeo())))
    await menu.findByRole('button', { name: 'Household settings, 2 offers waiting' })
    held.offers = [offerOfLeo()]
    socket.publish('ProfileShareChanged', shareChanged(OFFER_ID, liveShare({ status: 'ACTIVE' })))

    await menu.findByRole('button', { name: 'Household settings, 1 offer waiting' })
  })

  it('shouldKeepTheWaitingCountCurrentAfterTheAdminLeavesShareOffers', async () => {
    const { socket } = serveHome()
    const held = serveWaitingOffers([offer()])
    const { user } = renderAppAt('/settings/household/offers')
    await screen.findByRole('button', { name: 'Accept Alex' })
    await followingShareChanges(socket)
    await leaveForHome(user, { area: 'Household settings', heading: 'Share invitations' })

    held.offers = []
    socket.publish('ProfileShareChanged', shareChanged(OFFER_ID, liveShare({ status: 'ACTIVE' })))
    await user.click(screen.getByRole('button', { name: /^Profile menu/ }))

    const menu = within(await screen.findByTestId('profile-menu'))
    expect(await menu.findByRole('button', { name: 'Household settings' })).toHaveTextContent(
      /^Household settings$/,
    )
  })

  it('shouldShowNoWaitingCountAndNoErrorWhenTheOffersCannotBeRead', async () => {
    serveHome()
    const later = heldAnswer(offersData([offer()]))
    onTestFinished(later.release)
    const reads = answersInTurn(
      () => HttpResponse.json({ errors: [{ message: 'The offers could not be read.' }] }),
      later.answer,
    )
    server.use(graphql.query('ShareOffers', reads.resolver))
    const menu = await openTheProfileMenu()

    // The next read goes out only once the failed one has settled.
    await comeBackOnlineUntil(reads, 2)

    expect(menu.getByRole('button', { name: 'Household settings' })).toHaveTextContent(
      /^Household settings$/,
    )
    expect(within(screen.getByRole('banner')).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('The offers could not be read.')).not.toBeInTheDocument()
    later.release()
    await menu.findByRole('button', { name: 'Household settings, 1 offer waiting' })
  })

  it.each([
    ['a member of the Household', meFixture({ householdRole: 'MEMBER' })],
    ['a session bound to a TV', meFixture({ deviceBound: true })],
  ])('shouldReadNoOffersWhenTheSessionIsThatOf %s', async (_, me) => {
    const { socket } = serveHome(me)
    const held = serveWaitingOffers([offer()])

    const menu = await openTheProfileMenu()
    // The menu reads the identity it shows, so its reads have gone out by now.
    await menu.findByRole('button', { name: 'Sign out' })

    expect(menu.queryByRole('button', { name: /^Household settings/ })).not.toBeInTheDocument()
    expect(held.reads).toBe(0)
    expect(socket.isLive('ProfileShareChanged')).toBe(false)
  })
})
