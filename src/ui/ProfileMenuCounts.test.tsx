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
import { deferred } from '../test/deferred'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { HOUSEHOLD_ID, meFixture, type MeFixture } from '../test/meFixture'
import {
  answerNotification,
  notificationChange,
  notificationEdge,
  followingNotificationChanges,
  notificationsChanged,
  notificationsPage,
  offerNotification,
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
  )
}

async function openTheProfileMenu() {
  const { user } = renderAppAt('/')
  await user.click(await screen.findByRole('button', { name: /^Profile menu/ }))
  return within(await screen.findByTestId('profile-menu'))
}

const MARA_LINE = 'The offer of “Mara” was accepted.'

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

  it('shouldKeepTheCountCurrentWhenNotificationsChangeOnAnyPage', async () => {
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

  it('shouldTakeTheCountAMarkAnswersWhenNoChangeFollowsIt', async () => {
    serveHome()
    // Every count read after the first answers late, with the count as the server read it, so
    // that only the mark's answer can clear the count until they do.
    const held = { unread: 1, reads: 0, answered: 0 }
    const later = deferred()
    onTestFinished(later.resolve)
    server.use(
      graphql.query('UnreadNotificationCount', async () => {
        held.reads += 1
        const unreadNotificationCount = held.unread
        if (held.reads > 1) {
          await later.promise
          held.answered += 1
        }
        return HttpResponse.json({ data: { unreadNotificationCount } })
      }),
      graphql.query('Notifications', () =>
        HttpResponse.json({
          data: notificationsPage([answerNotification({ message: MARA_LINE, unread: true })]),
        }),
      ),
      graphql.mutation('MarkNotificationsRead', () => {
        held.unread = 0
        return HttpResponse.json({
          data: { markNotificationsRead: { unreadNotificationCount: 0, userErrors: [] } },
        })
      }),
    )
    const { user } = renderAppAt('/notifications')
    await screen.findByText(MARA_LINE)

    const chip = await screen.findByRole('button', { name: 'Profile menu (Owner)' })
    later.resolve()
    await waitFor(() => expect(held.answered).toBe(held.reads - 1))
    await user.click(chip)

    const menu = within(await screen.findByTestId('profile-menu'))
    expect(menu.getByRole('button', { name: 'Notifications' })).toBeVisible()
  })

  it('shouldKeepTheCountOfALaterChangeWhenAMarkSentBeforeItAnswersAfterIt', async () => {
    const { socket } = serveHome(meFixture(), 101)
    // A page that shows more than 100 is marked in two calls: the first 100, then Mara's.
    const first = Array.from({ length: 100 }, (_, index) =>
      answerNotification({
        id: `answer-${index}`,
        message: `The offer of “Profile ${index}” was accepted.`,
        unread: true,
      }),
    )
    const mara = answerNotification({ id: 'answer-for-mara', message: MARA_LINE, unread: true })
    // The first mark answers late, with the count as it stood after it: Mara is still unread.
    // Mara's mark answers only once the test has looked.
    const firstAnswer = deferred()
    const marasAnswer = deferred()
    onTestFinished(firstAnswer.resolve)
    onTestFinished(marasAnswer.resolve)
    const marks: string[][] = []
    server.use(
      graphql.query('Notifications', () =>
        HttpResponse.json({ data: notificationsPage([...first, mara]) }),
      ),
      graphql.mutation('MarkNotificationsRead', async ({ variables }) => {
        const { notificationIds } = (variables as { input: { notificationIds: string[] } }).input
        marks.push(notificationIds)
        const marksMara = notificationIds.includes(mara.id)
        await (marksMara ? marasAnswer : firstAnswer).promise
        const unreadNotificationCount = marksMara ? 0 : 1
        return HttpResponse.json({
          data: { markNotificationsRead: { unreadNotificationCount, userErrors: [] } },
        })
      }),
    )
    const { user } = renderAppAt('/notifications')
    await screen.findByText(MARA_LINE)
    await followingNotificationChanges(socket)
    await waitFor(() => expect(marks).toHaveLength(1))

    // Another session marks Mara read: the server tells this one, before the first mark answers.
    socket.publish('NotificationsChanged', notificationsChanged([], 1))
    socket.publish('NotificationsChanged', notificationsChanged([], 0))
    const chip = await screen.findByRole('button', { name: 'Profile menu (Owner)' })
    firstAnswer.resolve()
    // The page marks Mara only once the first mark has answered.
    await waitFor(() => expect(marks).toEqual([first.map(({ id }) => id), [mara.id]]))
    await user.click(chip)

    const menu = within(await screen.findByTestId('profile-menu'))
    expect(menu.getByRole('button', { name: 'Notifications' })).toBeVisible()
  })

  it('shouldCountFromAChangeWhenTheCountCouldNotBeRead', async () => {
    const { socket } = serveHome()
    server.use(
      graphql.query('UnreadNotificationCount', () =>
        HttpResponse.json({ errors: [{ message: 'The count could not be read.' }] }),
      ),
    )
    const menu = await openTheProfileMenu()
    await followingNotificationChanges(socket)

    socket.publish('NotificationsChanged', notificationsChanged([], 4))

    expect(await menu.findByRole('button', { name: 'Notifications, 4 unread' })).toBeVisible()
  })

  it('shouldReadNoCountWhenTheSessionIsBoundToATV', async () => {
    const { socket, reads } = serveHome(meFixture({ deviceBound: true }), 3)

    await openTheProfileMenu()

    expect(screen.queryByRole('button', { name: /^Notifications/ })).not.toBeInTheDocument()
    expect(reads.unread).toBe(0)
    expect(socket.isLive('NotificationsChanged')).toBe(false)
  })

  it('shouldReadNoCountWhenTheProfilePickerIsOpen', async () => {
    const { socket, reads } = serveHome(meFixture(), 3)

    renderAppAt('/select-profile')

    await screen.findByRole('heading', { name: /who's watching\?/i })
    // The picker reads the Profiles from the same identity the count would wait for.
    await screen.findByRole('button', { name: 'Alex' })
    expect(reads.unread).toBe(0)
    expect(socket.isLive('NotificationsChanged')).toBe(false)
  })
  it('shouldReadNoCountWhenSignedOut', async () => {
    const socket = serveGraphqlSocket()
    const reads = { unread: 0, offers: 0 }
    server.use(
      graphql.query('UnreadNotificationCount', () => {
        reads.unread += 1
        return HttpResponse.json({ data: { unreadNotificationCount: 3 } })
      }),
      graphql.query('ShareOffers', () => {
        reads.offers += 1
        return HttpResponse.json({ data: offersData([offer()]) })
      }),
    )

    renderAppAt('/login')

    await screen.findByRole('button', { name: /sign in/i })
    expect(reads).toEqual({ unread: 0, offers: 0 })
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

  it('shouldKeepTheWaitingCountCurrentWhenSharesChangeOnAnyPage', async () => {
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

  it('shouldKeepTheWaitingCountCurrentWhenTheAdminHasLeftShareOffers', async () => {
    const { socket } = serveHome()
    const held = serveWaitingOffers([offer()])
    const { user } = renderAppAt('/settings/household/offers')
    await screen.findByRole('button', { name: 'Accept Alex' })
    await followingShareChanges(socket)
    await leaveForHome(user, { area: 'Household settings', heading: 'Share offers' })

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

describe('The dot on the Profile menu', () => {
  const MARKED = 'Profile menu (Owner), has notifications'

  it('shouldMarkTheAvatarWithoutANumberWhenNotificationsAreUnread', async () => {
    serveHome(meFixture(), 3)

    renderAppAt('/')

    const chip = await screen.findByRole('button', { name: MARKED })
    expect(within(chip).getByTestId('unread-dot')).toBeVisible()
    expect(chip).toHaveTextContent(/^OW$/)
  })

  it('shouldMarkTheAvatarWhenOffersWait', async () => {
    serveHome()
    server.use(
      graphql.query('ShareOffers', () => HttpResponse.json({ data: offersData([offer()]) })),
    )

    renderAppAt('/')

    expect(await screen.findByRole('button', { name: MARKED })).toBeVisible()
  })

  it('shouldClearTheMarkWhenNothingInsideIsCountedAnyMore', async () => {
    const { socket } = serveHome(meFixture(), 3)
    renderAppAt('/')
    await screen.findByRole('button', { name: MARKED })
    await followingNotificationChanges(socket)

    socket.publish('NotificationsChanged', notificationsChanged([], 0))

    const chip = await screen.findByRole('button', { name: 'Profile menu (Owner)' })
    expect(within(chip).queryByTestId('unread-dot')).not.toBeInTheDocument()
  })

  it('shouldTakeADismissedRequestOutOfTheListTheCountAndTheDotInOneChange', async () => {
    const { socket } = serveHome(meFixture(), 1)
    const waiting = offerNotification()
    // The page's mark of the offer answers only once the test has looked, so that only the
    // dismissal can clear the count.
    const markAnswer = deferred()
    onTestFinished(markAnswer.resolve)
    server.use(
      graphql.query('Notifications', () =>
        HttpResponse.json({ data: notificationsPage([waiting]) }),
      ),
      graphql.mutation('MarkNotificationsRead', async () => {
        await markAnswer.promise
        return HttpResponse.json({
          data: { markNotificationsRead: { unreadNotificationCount: 0, userErrors: [] } },
        })
      }),
    )
    const { user } = renderAppAt('/notifications')
    await screen.findByText(waiting.message)
    await screen.findByRole('button', { name: MARKED })
    await followingNotificationChanges(socket)

    // The Account is no longer the Household's admin: its request about the offer is dismissed.
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(waiting.id, null)], 0),
    )

    expect(await screen.findByText('No notifications.')).toBeVisible()
    const chip = await screen.findByRole('button', { name: 'Profile menu (Owner)' })
    expect(within(chip).queryByTestId('unread-dot')).not.toBeInTheDocument()
    await user.click(chip)
    const menu = within(await screen.findByTestId('profile-menu'))
    expect(menu.getByRole('button', { name: 'Notifications' })).toHaveTextContent(/^Notifications$/)
  })
})
