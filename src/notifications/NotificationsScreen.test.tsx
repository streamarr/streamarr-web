import { act, screen, waitFor, within } from '@testing-library/react'
import { graphql, http, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  NotificationsQuery,
  ProfileShareStatus,
  RequestResolution,
} from '../graphql/generated/graphql'
import {
  answerDelivered,
  answersInTurn,
  answerWith,
  comeBackOnline,
  heldAnswer,
  readsThatCanBeHeld,
} from '../test/graphqlResponses'
import { deferred } from '../test/deferred'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { meFixture } from '../test/meFixture'
import {
  answerNotification,
  followingNotificationChanges,
  hoursAgo,
  notificationChange,
  notificationEdge,
  notificationsChanged,
  notificationsPage,
  offerNotification,
} from '../test/notificationFixtures'
import { renderAppAt } from '../test/render'
import { leaveForHome, returnThroughTheProfileMenu, type SettingsPage } from '../test/returnVisits'
import { server } from '../test/server'
import { signIn } from '../test/signIn'
import { intersectionObserverInstances } from '../../vitest.setup'

const NOTIFICATIONS = '/notifications'
const NOTIFICATIONS_PAGE: SettingsPage = { area: 'Notifications', heading: 'Notifications' }
const HOUR = 60 * 60 * 1000
const OFFER_LINE = '“Sam” offered the Profile “Alex” to your Household.'
const ANSWER_LINE = '“Cabin” accepted the Profile “Leo”.'

/** Each Notification the page marked read, and on which visit. */
interface Mark {
  notificationId: string
  visit: number
}

function serve(page: NotificationsQuery = notificationsPage([]), me = meFixture()) {
  const socket = serveGraphqlSocket()
  const marks: Mark[] = []
  const visits = { count: 1 }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('Notifications', () => HttpResponse.json({ data: page })),
    graphql.mutation('MarkNotificationRead', ({ variables }) => {
      const { notificationId } = (variables as { input: { notificationId: string } }).input
      marks.push({ notificationId, visit: visits.count })
      return HttpResponse.json({
        data: {
          markNotificationRead: {
            __typename: 'MarkNotificationReadPayload',
            unreadNotificationCount: 0,
            userErrors: [],
          },
        },
      })
    }),
  )
  return { socket, marks, visits }
}

function rows() {
  return within(screen.getByRole('list', { name: 'Notifications' })).getAllByRole('listitem')
}

function lines() {
  return rows().map((row) => row.querySelector('p')?.textContent)
}

/** Brings the end of the list into view, as scrolling to it does. */
async function reachTheEndOfTheList() {
  const end = await screen.findByTestId('older-notifications')
  const observer = intersectionObserverInstances.findLast((instance) =>
    instance.observe.mock.calls.some(([target]) => target === end),
  )!
  act(() =>
    observer.callback(
      [{ target: end, isIntersecting: true } as unknown as IntersectionObserverEntry],
      observer,
    ),
  )
}

/** News of an answer about the Profile `name`, read. */
function answerAbout(name: string) {
  return answerNotification({
    id: `answer-for-${name}`,
    message: `“Cabin” accepted the Profile “${name}”.`,
  })
}

/** Serves the list in pages: the newest page, then each older page after the one before it. */
function servePages(...pages: NotificationsQuery[]) {
  const reads: (string | null)[] = []
  server.use(
    graphql.query('Notifications', ({ variables }) => {
      const after = (variables as { after?: string | null }).after ?? null
      reads.push(after)
      const page =
        after === null
          ? pages[0]
          : pages.find(
              (_, index) =>
                index > 0 && pages[index - 1].notifications.pageInfo.endCursor === after,
            )
      return HttpResponse.json({ data: page })
    }),
  )
  return reads
}

describe('Notifications', () => {
  it('shouldOpenNotificationsWhenTheAccountChoosesThemInTheProfileMenu', async () => {
    serve(notificationsPage([offerNotification()]))
    server.use(
      graphql.query('Home', () =>
        HttpResponse.json({ data: { continueWatching: { edges: [] }, libraries: [] } }),
      ),
    )
    const { user, router } = renderAppAt('/')

    await user.click(await screen.findByRole('button', { name: /^Profile menu/ }))
    await user.click(screen.getByRole('button', { name: 'Notifications' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
    expect(router.state.location.pathname).toBe(NOTIFICATIONS)
  })

  it('shouldStandOnTheNeutralGroundWhenNotificationsOpen', async () => {
    serve()
    renderAppAt(NOTIFICATIONS)

    await screen.findByRole('heading', { level: 1, name: 'Notifications' })

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByTestId('home-shell')).toBeInTheDocument()
    expect(screen.queryByTestId('browsing-wash')).not.toBeInTheDocument()
  })

  it('shouldListEachNotificationInTheServersOrderAndWordsWhenTheyLoad', async () => {
    serve(
      notificationsPage([
        offerNotification(),
        answerNotification({ message: '“<b>Cabin</b>” accepted the Profile “Leo”.' }),
      ]),
    )
    renderAppAt(NOTIFICATIONS)

    await screen.findByText('“Sam” offered the Profile “Alex” to your Household.')

    expect(rows().map((row) => row.querySelector('p')?.textContent)).toEqual([
      '“Sam” offered the Profile “Alex” to your Household.',
      '“<b>Cabin</b>” accepted the Profile “Leo”.',
    ])
    expect(document.querySelector('b')).toBeNull()
  })

  it('shouldSayWhenEachNotificationHappenedWhenTheyLoad', async () => {
    const longAgo = new Date(2026, 9, 3, 14, 5)
    serve(
      notificationsPage([
        offerNotification({ latestEventAt: hoursAgo(3) }),
        answerNotification({ latestEventAt: longAgo.toISOString() }),
      ]),
    )
    renderAppAt(NOTIFICATIONS)

    await screen.findByText('3 hours ago')

    const [recent, older] = rows()
    expect(within(recent).getByText('3 hours ago')).toBeVisible()
    expect(within(older).getByText('Oct 3, 2026')).toBeVisible()
    expect(older).toHaveTextContent(/Saturday, October 3, 2026 at 2:05/)
    expect(older.querySelector('time')).toHaveAttribute('dateTime', longAgo.toISOString())
  })

  it('shouldSayThereAreNoNotificationsWhenTheListIsEmpty', async () => {
    serve()
    renderAppAt(NOTIFICATIONS)

    expect(await screen.findByText('No notifications.')).toBeVisible()
    expect(screen.queryByRole('list', { name: 'Notifications' })).not.toBeInTheDocument()
  })

  it('shouldReadNoNotificationsWhenTheSessionIsBoundToATV', async () => {
    const { socket } = serve(
      notificationsPage([offerNotification()]),
      meFixture({ deviceBound: true }),
    )
    const list = { reads: 0 }
    server.use(
      graphql.query('Notifications', () => {
        list.reads += 1
        return HttpResponse.json({ data: notificationsPage([offerNotification()]) })
      }),
    )
    renderAppAt(NOTIFICATIONS)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Notifications are available using an account session.',
    )
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/')
    expect(list.reads).toBe(0)
    expect(socket.isLive('NotificationsChanged')).toBe(false)
  })

  it('shouldOfferRetryWhenTheListCannotLoad', async () => {
    const { socket } = serve()
    const list = { failing: true, reads: 0 }
    server.use(
      graphql.query('Notifications', () => {
        list.reads += 1
        return list.failing
          ? HttpResponse.json({ errors: [{ message: 'boom' }] })
          : HttpResponse.json({ data: notificationsPage([offerNotification()]) })
      }),
    )
    const { user } = renderAppAt(NOTIFICATIONS)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load notifications.")
    // Once it follows changes, the page reads again, and that read fails too.
    await followingNotificationChanges(socket)
    await waitFor(() => expect(list.reads).toBe(2))
    list.failing = false
    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText(OFFER_LINE)).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})

describe('Requests in Notifications', () => {
  it('shouldLinkAnOfferToShareOffersWhenItWaitsForADecision', async () => {
    serve(notificationsPage([offerNotification(), answerNotification()]))
    renderAppAt(NOTIFICATIONS)

    const review = await screen.findByRole('link', { name: 'Review' })

    expect(review).toHaveAttribute('href', '/settings/household/offers')
    expect(review).toHaveAccessibleDescription(OFFER_LINE)
    expect(screen.getAllByRole('link', { name: 'Review' })).toHaveLength(1)
  })

  it.each<[RequestResolution, ProfileShareStatus, string]>([
    ['DECIDED', 'ACTIVE', 'Accepted'],
    ['DECIDED', 'ENDED', 'Accepted'],
    ['DECIDED', 'REJECTED', 'Declined'],
    ['WITHDRAWN', 'CANCELED', 'Withdrawn'],
    ['WITHDRAWN', 'INVALIDATED', 'Withdrawn'],
    ['EXPIRED', 'EXPIRED', 'Expired'],
  ])(
    'shouldSayHowAnOfferEndedInPlaceOfReviewWhenItResolved: %s with the share %s',
    async (resolution, status, ending) => {
      serve(
        notificationsPage([
          offerNotification({
            unread: false,
            resolution,
            share: { __typename: 'ProfileShare', id: 'share-of-alex', status },
          }),
        ]),
      )
      renderAppAt(NOTIFICATIONS)

      await screen.findByText(OFFER_LINE)

      expect(within(rows()[0]).getByText(ending)).toBeVisible()
      expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
    },
  )

  it('shouldSayHowLongAgoAgainWhenTimePassesWithThePageOpen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
    onTestFinished(() => void vi.useRealTimers())
    serve(
      notificationsPage([
        answerNotification({ latestEventAt: new Date(Date.now() - 10_000).toISOString() }),
      ]),
    )
    renderAppAt(NOTIFICATIONS)
    expect(await within(await screen.findByRole('listitem')).findByText('Just now')).toBeVisible()

    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(await within(rows()[0]).findByText('1 minute ago')).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(HOUR))

    expect(await within(rows()[0]).findByText('1 hour ago')).toBeVisible()
  })

  it('shouldSayAnOfferExpiredWhenItsTimeRunsOutWithThePageOpen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
    onTestFinished(() => void vi.useRealTimers())
    serve(
      notificationsPage([
        offerNotification({ expiresAt: new Date(Date.now() + HOUR).toISOString() }),
      ]),
    )
    renderAppAt(NOTIFICATIONS)
    await screen.findByRole('link', { name: 'Review' })

    await act(() => vi.advanceTimersByTimeAsync(HOUR))

    expect(await within(rows()[0]).findByText('Expired')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
  })
  it('shouldMoveFocusToTheHeadingWhenTheOfferThePersonIsOnExpiresWithThePageOpen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
    onTestFinished(() => void vi.useRealTimers())
    serve(
      notificationsPage([
        offerNotification({ expiresAt: new Date(Date.now() + HOUR).toISOString() }),
      ]),
    )
    renderAppAt(NOTIFICATIONS)
    const review = await screen.findByRole('link', { name: 'Review' })
    act(() => review.focus())

    await act(() => vi.advanceTimersByTimeAsync(HOUR))

    expect(await within(rows()[0]).findByText('Expired')).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toHaveFocus(),
    )
  })
})

describe('Reading Notifications', () => {
  it('shouldMarkAnUnreadNotificationWithoutColourAloneWhenItIsListed', async () => {
    serve(notificationsPage([offerNotification({ unread: true }), answerNotification()]))
    renderAppAt(NOTIFICATIONS)

    await screen.findByText(OFFER_LINE)

    const [unread, read] = rows()
    expect(within(unread).getByText('Unread')).toBeInTheDocument()
    expect(within(unread).getByTestId('unread-mark')).toBeVisible()
    expect(within(read).queryByText('Unread')).not.toBeInTheDocument()
    expect(within(read).queryByTestId('unread-mark')).not.toBeInTheDocument()
  })

  it('shouldMarkReadByIdOnlyTheUnreadNotificationsThePageShowsWhenTheListHasRendered', async () => {
    const mara = answerNotification({
      id: 'answer-for-mara',
      message: '“Lake House” accepted the Profile “Mara”.',
      unread: true,
    })
    const { marks } = serve(
      notificationsPage([offerNotification(), answerNotification(), mara], { hasNextPage: true }),
    )
    renderAppAt(NOTIFICATIONS)

    await screen.findByText(OFFER_LINE)

    await waitFor(() =>
      expect(marks).toEqual([
        { notificationId: 'offer-of-alex', visit: 1 },
        { notificationId: 'answer-for-mara', visit: 1 },
      ]),
    )
  })

  it('shouldKeepTheUnreadMarkUntilTheNextVisitWhenTheServerSaysTheMarkReadIt', async () => {
    const held = { page: notificationsPage([offerNotification()]) }
    const { socket, marks } = serve()
    server.use(graphql.query('Notifications', () => HttpResponse.json({ data: held.page })))
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)
    await followingNotificationChanges(socket)
    await waitFor(() => expect(marks).toHaveLength(1))

    // The server tells every socket that the mark read it; Leo's news shows the change applied.
    const read = offerNotification({ unread: false })
    const leo = answerNotification()
    held.page = notificationsPage([leo, read], { from: 0 })
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([
        notificationChange(read.id, notificationEdge(read, 1)),
        notificationChange(leo.id, notificationEdge(leo, 0)),
      ]),
    )
    await screen.findByText(ANSWER_LINE)

    const offerRow = rows()[1]
    expect(within(offerRow).getByText('Unread')).toBeInTheDocument()
    expect(within(offerRow).getByTestId('unread-mark')).toBeVisible()
    await leaveForHome(user, NOTIFICATIONS_PAGE)
    await returnThroughTheProfileMenu(user, NOTIFICATIONS_PAGE)
    await screen.findByText(OFFER_LINE)
    expect(within(rows()[1]).queryByText('Unread')).not.toBeInTheDocument()
    expect(within(rows()[1]).queryByTestId('unread-mark')).not.toBeInTheDocument()
  })

  it('shouldLeaveUnreadUntilTheNextVisitANotificationThatArrivesWhenThePageIsOpen', async () => {
    const held = { page: notificationsPage([offerNotification()], { from: 1 }) }
    const { socket, marks, visits } = serve()
    server.use(graphql.query('Notifications', () => HttpResponse.json({ data: held.page })))
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)
    await followingNotificationChanges(socket)
    await waitFor(() => expect(marks).toHaveLength(1))

    // Leo's news commits late: it sorts below the row the page showed first.
    const leo = answerNotification({ unread: true, latestEventAt: hoursAgo(5) })
    held.page = notificationsPage([offerNotification({ unread: false }), leo], { from: 1 })
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(leo.id, notificationEdge(leo, 2))]),
    )
    await screen.findByText(ANSWER_LINE)
    await leaveForHome(user, NOTIFICATIONS_PAGE)
    visits.count = 2
    await returnThroughTheProfileMenu(user, NOTIFICATIONS_PAGE)

    await waitFor(() => expect(marks.filter((mark) => mark.visit === 2)).toHaveLength(1))
    expect(marks).toEqual([
      { notificationId: 'offer-of-alex', visit: 1 },
      { notificationId: 'answer-for-leo', visit: 2 },
    ])
  })

  it('shouldSendNoMarkOnceThePersonHasSignedOutWhenTheVisitStillHadMarksToSend', async () => {
    const leo = answerNotification({ id: 'answer-for-leo', unread: true })
    const mara = { ...answerAbout('Mara'), unread: true }
    serve(notificationsPage([leo, mara]))
    const session = { signedIn: true }
    const marks: { notificationId: string; signedIn: boolean }[] = []
    // The page sends Mara's mark only after Leo's mark answers, and Leo's mark answers only after
    // the person has signed out.
    const leosAnswer = deferred()
    onTestFinished(leosAnswer.resolve)
    const signedOut = deferred()
    server.use(
      http.post('/api/auth/refresh/revoke', () => {
        session.signedIn = false
        signedOut.resolve()
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('/api/auth/login', () => {
        session.signedIn = true
        return HttpResponse.json({ accessTokenExpiresAt: '2026-08-06T12:10:00Z', scope: 'account' })
      }),
      graphql.mutation('MarkNotificationRead', async ({ variables }) => {
        const { notificationId } = (variables as { input: { notificationId: string } }).input
        const { signedIn } = session
        marks.push({ notificationId, signedIn })
        if (notificationId === leo.id) await leosAnswer.promise
        // The server refuses a mark sent while signed out. If that refusal arrives after the person
        // has signed in again, the app sends the person back to the sign-in page.
        if (!signedIn) {
          return Response.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 })
        }
        return HttpResponse.json({
          data: { markNotificationRead: { unreadNotificationCount: 1, userErrors: [] } },
        })
      }),
    )
    const { user, router } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(mara.message)
    await waitFor(() => expect(marks).toEqual([{ notificationId: leo.id, signedIn: true }]))

    await user.click(screen.getByRole('button', { name: /^Profile menu/ }))
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await signedOut.promise
    leosAnswer.resolve()
    // Mara's mark would go out right after Leo's mark answers, long before the person has signed
    // in again and left the sign-in page.
    await signIn(user)
    await waitFor(() => {
      expect(router.state.location.pathname).not.toBe('/login')
      expect(router.state.status).toBe('idle')
    })

    expect(marks).toEqual([{ notificationId: leo.id, signedIn: true }])
  })
})

describe('Older Notifications', () => {
  const NEWEST = notificationsPage([answerAbout('Alex'), answerAbout('Sam')], { hasNextPage: true })
  const OLDER = notificationsPage([answerAbout('Mara'), answerAbout('Leo')], { from: 3 })

  it('shouldLoadOlderNotificationsWhenTheEndOfTheListComesIntoView', async () => {
    serve()
    const reads = servePages(NEWEST, OLDER)
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('“Cabin” accepted the Profile “Alex”.')

    await reachTheEndOfTheList()

    await screen.findByText('“Cabin” accepted the Profile “Leo”.')
    expect(lines()).toEqual([
      '“Cabin” accepted the Profile “Alex”.',
      '“Cabin” accepted the Profile “Sam”.',
      '“Cabin” accepted the Profile “Mara”.',
      '“Cabin” accepted the Profile “Leo”.',
    ])
    expect(reads).toContain('cursor-002')
    expect(screen.queryByTestId('older-notifications')).not.toBeInTheDocument()
  })

  it('shouldMarkReadTheUnreadNotificationsOfAnOlderPageWhenItJoinsTheList', async () => {
    const { marks } = serve()
    const mara = answerNotification({
      id: 'answer-for-mara',
      message: '“Cabin” accepted the Profile “Mara”.',
      unread: true,
    })
    servePages(NEWEST, notificationsPage([mara, answerAbout('Leo')], { from: 3 }))
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('“Cabin” accepted the Profile “Alex”.')

    await reachTheEndOfTheList()

    await screen.findByText('“Cabin” accepted the Profile “Mara”.')
    await waitFor(() => expect(marks).toEqual([{ notificationId: 'answer-for-mara', visit: 1 }]))
  })

  it('shouldMarkNothingOfAnOlderPageWhenItRepeatsANotificationThePageAlreadyShows', async () => {
    const { socket, marks } = serve()
    const mara = answerNotification({
      id: 'answer-for-mara',
      message: '“Cabin” accepted the Profile “Mara”.',
      unread: true,
    })
    const leo = answerNotification({ id: 'answer-for-leo', unread: true })
    servePages(NEWEST, notificationsPage([mara, leo], { from: 3 }))
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('“Cabin” accepted the Profile “Alex”.')
    await followingNotificationChanges(socket)
    // Mara's news arrives live, so the page leaves it unread; the older page brings it again.
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(mara.id, notificationEdge(mara, 0))]),
    )
    await screen.findByText('“Cabin” accepted the Profile “Mara”.')

    await reachTheEndOfTheList()

    await screen.findByText(ANSWER_LINE)
    await waitFor(() => expect(marks).toEqual([{ notificationId: 'answer-for-leo', visit: 1 }]))
  })

  it('shouldLoadOlderNotificationsWhenTheNewestPageHasNoneToShow', async () => {
    serve()
    servePages(
      notificationsPage([null], { hasNextPage: true }),
      notificationsPage([answerAbout('Mara'), answerAbout('Leo')], { from: 2 }),
    )
    renderAppAt(NOTIFICATIONS)

    await reachTheEndOfTheList()

    await screen.findByText('“Cabin” accepted the Profile “Leo”.')
    expect(lines()).toEqual([
      '“Cabin” accepted the Profile “Mara”.',
      '“Cabin” accepted the Profile “Leo”.',
    ])
    expect(screen.queryByText('No notifications.')).not.toBeInTheDocument()
  })

  it('shouldShowANotificationOnceWhenTheOlderPageRepeatsOneItShows', async () => {
    serve()
    servePages(NEWEST, notificationsPage([answerAbout('Sam'), answerAbout('Leo')], { from: 3 }))
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('“Cabin” accepted the Profile “Alex”.')

    await reachTheEndOfTheList()

    await screen.findByText('“Cabin” accepted the Profile “Leo”.')
    expect(lines()).toEqual([
      '“Cabin” accepted the Profile “Alex”.',
      '“Cabin” accepted the Profile “Sam”.',
      '“Cabin” accepted the Profile “Leo”.',
    ])
  })

  it('shouldOfferRetryWhenOlderNotificationsCannotLoad', async () => {
    serve()
    servePages(NEWEST, OLDER)
    const older = { failures: 1 }
    server.use(
      graphql.query('Notifications', ({ variables }) => {
        if (!(variables as { after?: string | null }).after || older.failures === 0) return
        older.failures -= 1
        return HttpResponse.json({ errors: [{ message: 'boom' }] })
      }),
    )
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText('“Cabin” accepted the Profile “Alex”.')

    await reachTheEndOfTheList()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load older notifications.")
    expect(lines()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('“Cabin” accepted the Profile “Leo”.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldKeepTheOlderNotificationsItLoadedWhenTheListIsReadAgain', async () => {
    serve()
    const reads = servePages(NEWEST, OLDER)
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('“Cabin” accepted the Profile “Alex”.')
    await reachTheEndOfTheList()
    await screen.findByText('“Cabin” accepted the Profile “Leo”.')

    comeBackOnline()

    await waitFor(() => expect(reads.filter((after) => after === null)).toHaveLength(2))
    await waitFor(() =>
      expect(lines()).toEqual([
        '“Cabin” accepted the Profile “Alex”.',
        '“Cabin” accepted the Profile “Sam”.',
        '“Cabin” accepted the Profile “Mara”.',
        '“Cabin” accepted the Profile “Leo”.',
      ]),
    )
  })

  it('shouldAddNoOlderPageWhenTheListReadAgainEndsElsewhereBeforeItArrives', async () => {
    const { socket } = serve()
    const late = heldAnswer(OLDER)
    onTestFinished(late.release)
    const older = { calls: 0 }
    const newest = { page: NEWEST }
    server.use(
      graphql.query('Notifications', ({ variables }) => {
        if (!(variables as { after?: string | null }).after) {
          return HttpResponse.json({ data: newest.page })
        }
        older.calls += 1
        return late.answer()
      }),
    )
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('“Cabin” accepted the Profile “Alex”.')
    await followingNotificationChanges(socket)
    await reachTheEndOfTheList()
    await waitFor(() => expect(older.calls).toBe(1))

    // Sam's news and everything older were deleted, which no change says: the list read again ends
    // at Alex, and only then does the older page asked for after Sam answer.
    newest.page = notificationsPage([answerAbout('Alex')])
    comeBackOnline()
    await waitFor(() => expect(lines()).toEqual(['“Cabin” accepted the Profile “Alex”.']))
    const answered = answerDelivered('Notifications')
    late.release()
    await answered
    // News that arrives after the older page answered: once it shows, that answer was handled.
    const sentinel = answerNotification({
      id: 'answer-for-sam',
      message: '“Lake House” accepted the Profile “Sam”.',
    })
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(sentinel.id, notificationEdge(sentinel, 0))]),
    )
    await screen.findByText('“Lake House” accepted the Profile “Sam”.')

    expect(lines()).toEqual([
      '“Lake House” accepted the Profile “Sam”.',
      '“Cabin” accepted the Profile “Alex”.',
    ])
  })

  it('shouldShowOnlyTheNewestPageWhenThePersonReturns', async () => {
    serve()
    servePages(NEWEST, OLDER)
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText('“Cabin” accepted the Profile “Alex”.')
    await reachTheEndOfTheList()
    await screen.findByText('“Cabin” accepted the Profile “Leo”.')

    await leaveForHome(user, NOTIFICATIONS_PAGE)
    await returnThroughTheProfileMenu(user, NOTIFICATIONS_PAGE)

    await screen.findByText('“Cabin” accepted the Profile “Alex”.')
    expect(lines()).toEqual([
      '“Cabin” accepted the Profile “Alex”.',
      '“Cabin” accepted the Profile “Sam”.',
    ])
  })

  describe('while a read of an earlier visit is on its way', () => {
    /**
     * Opens the page and asks for the older page while Mara's news is unread, and holds that read
     * at the server. The person then leaves and opens the page again, which marks Mara's news read.
     * Returns the held read of the first visit.
     */
    async function returnWhileTheFirstVisitsReadIsHeld() {
      serve()
      const stored = {
        older: notificationsPage([{ ...answerAbout('Mara'), unread: true }, answerAbout('Leo')], {
          from: 3,
        }),
      }
      const olderReads = readsThatCanBeHeld(() => stored.older)
      server.use(
        graphql.query('Notifications', ({ variables }) =>
          (variables as { after?: string | null }).after
            ? olderReads.resolver()
            : HttpResponse.json({ data: NEWEST }),
        ),
      )
      const { user } = renderAppAt(NOTIFICATIONS)
      await screen.findByText('“Cabin” accepted the Profile “Alex”.')
      const firstVisitsRead = olderReads.holdNext()
      onTestFinished(firstVisitsRead.release)
      await reachTheEndOfTheList()
      await firstVisitsRead.arrived

      await leaveForHome(user, NOTIFICATIONS_PAGE)
      stored.older = OLDER
      await returnThroughTheProfileMenu(user, NOTIFICATIONS_PAGE)
      await screen.findByText('“Cabin” accepted the Profile “Alex”.')
      return firstVisitsRead
    }

    /** Mara's news, on the older page, is read, as the second visit made it. */
    async function expectMarasNewsAsThisVisitMarkedIt() {
      await screen.findByText('“Cabin” accepted the Profile “Leo”.')
      const mara = rows()[2]
      expect(mara).toHaveTextContent('“Cabin” accepted the Profile “Mara”.')
      expect(within(mara).queryByText('Unread')).not.toBeInTheDocument()
    }

    it('shouldShowOlderNotificationsAsThisVisitReadsThemWhenAnEarlierVisitsReadAnswersLate', async () => {
      const firstVisitsRead = await returnWhileTheFirstVisitsReadIsHeld()

      firstVisitsRead.release()
      await reachTheEndOfTheList()

      await expectMarasNewsAsThisVisitMarkedIt()
    })

    it('shouldShowOlderNotificationsAsThisVisitReadsThemWhenThisVisitAsksBeforeAnEarlierVisitsReadAnswers', async () => {
      const firstVisitsRead = await returnWhileTheFirstVisitsReadIsHeld()

      await reachTheEndOfTheList()
      firstVisitsRead.release()

      await expectMarasNewsAsThisVisitMarkedIt()
    })
  })

  it('shouldLoadOlderNotificationsWhenEveryLoadedOneLeavesTheList', async () => {
    const { socket } = serve()
    servePages(NEWEST, OLDER)
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('“Cabin” accepted the Profile “Alex”.')
    await followingNotificationChanges(socket)

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([
        notificationChange(answerAbout('Alex').id, null),
        notificationChange(answerAbout('Sam').id, null),
      ]),
    )
    // With every loaded row gone, the page shows no empty list, and it does not say there are none.
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Notifications' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByText('No notifications.')).not.toBeInTheDocument()
    await reachTheEndOfTheList()

    await screen.findByText('“Cabin” accepted the Profile “Leo”.')
    expect(lines()).toEqual([
      '“Cabin” accepted the Profile “Mara”.',
      '“Cabin” accepted the Profile “Leo”.',
    ])
  })

  it('shouldShowAnOlderNotificationInItsPlaceWhenItChangesAfterEveryLoadedOneLeft', async () => {
    const { socket } = serve()
    servePages(NEWEST, OLDER)
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('“Cabin” accepted the Profile “Alex”.')
    await followingNotificationChanges(socket)
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([
        notificationChange(answerAbout('Alex').id, null),
        notificationChange(answerAbout('Sam').id, null),
      ]),
    )
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Notifications' })).not.toBeInTheDocument(),
    )

    // Another device marks Leo's news read, on the page after the loaded one. Nora's news arrives
    // next, so its row shows that the page has taken Leo's change.
    const leo = answerAbout('Leo')
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(leo.id, notificationEdge(leo, 4))]),
    )
    const nora = { ...answerAbout('Nora'), unread: true }
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(nora.id, notificationEdge(nora, 0))]),
    )
    await screen.findByText('“Cabin” accepted the Profile “Nora”.')
    await reachTheEndOfTheList()

    await screen.findByText('“Cabin” accepted the Profile “Mara”.')
    expect(lines()).toEqual([
      '“Cabin” accepted the Profile “Nora”.',
      '“Cabin” accepted the Profile “Mara”.',
      '“Cabin” accepted the Profile “Leo”.',
    ])
  })
})

describe('Notifications as they change elsewhere', () => {
  async function openWithAnOffer(page = notificationsPage([offerNotification()])) {
    const { socket } = serve(page)
    const rendered = renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)
    await followingNotificationChanges(socket)
    return { socket, ...rendered }
  }

  const leo = answerNotification({ unread: true })

  it('shouldListANotificationFirstWhenItArrivesWhileThePageIsOpen', async () => {
    const { socket } = await openWithAnOffer()

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(leo.id, notificationEdge(leo, 0))], 2),
    )

    await waitFor(() => expect(lines()).toEqual([ANSWER_LINE, OFFER_LINE]))
    expect(within(rows()[0]).getByText('Unread')).toBeInTheDocument()
  })

  it('shouldKeepFocusWhereThePersonIsWhenANotificationArrives', async () => {
    const { socket } = await openWithAnOffer()
    const review = screen.getByRole('link', { name: 'Review' })
    act(() => review.focus())

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(leo.id, notificationEdge(leo, 0))]),
    )

    await screen.findByText(ANSWER_LINE)
    expect(review).toHaveFocus()
  })

  function expectFocusOnTheHeading() {
    return waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toHaveFocus(),
    )
  }

  it('shouldMoveFocusToTheHeadingWhenTheReviewThePersonIsOnIsDecidedElsewhere', async () => {
    const { socket } = await openWithAnOffer()
    act(() => screen.getByRole('link', { name: 'Review' }).focus())
    const accepted = offerNotification({
      unread: false,
      resolution: 'DECIDED',
      share: { __typename: 'ProfileShare', id: 'share-of-alex', status: 'ACTIVE' },
    })

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(accepted.id, notificationEdge(accepted, 1))]),
    )

    await within(rows()[0]).findByText('Accepted')
    await expectFocusOnTheHeading()
  })

  it('shouldMoveFocusToTheHeadingWhenTheNotificationThePersonIsOnLeavesTheList', async () => {
    const { socket } = await openWithAnOffer()
    act(() => screen.getByRole('link', { name: 'Review' }).focus())

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(offerNotification().id, null)]),
    )

    await screen.findByText('No notifications.')
    await expectFocusOnTheHeading()
  })

  it('shouldSayHowARequestEndedWhenItIsDecidedElsewhere', async () => {
    const { socket } = await openWithAnOffer()
    const accepted = offerNotification({
      unread: false,
      resolution: 'DECIDED',
      share: { __typename: 'ProfileShare', id: 'share-of-alex', status: 'ACTIVE' },
    })

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(accepted.id, notificationEdge(accepted, 1))]),
    )

    expect(await within(rows()[0]).findByText('Accepted')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
    // It was unread when the page opened, so it stays marked until the next visit.
    expect(within(rows()[0]).getByText('Unread')).toBeInTheDocument()
  })

  it('shouldTakeANotificationOutWhenItLeavesTheList', async () => {
    const { socket } = await openWithAnOffer(
      notificationsPage([offerNotification(), answerNotification()]),
    )

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(offerNotification().id, null)]),
    )

    await waitFor(() => expect(lines()).toEqual([ANSWER_LINE]))
  })

  it('shouldKeepANotificationWhenItsChangeCameWithAnError', async () => {
    const { socket } = serve()
    const reads = readsThatCanBeHeld(() => notificationsPage([offerNotification()]))
    server.use(graphql.query('Notifications', reads.resolver))
    renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)
    await followingNotificationChanges(socket)
    // The change's error reads the list again; held, its answer cannot put back a row taken out.
    const readAfterTheError = reads.holdNext()
    onTestFinished(readAfterTheError.release)

    socket.publish('NotificationsChanged', {
      ...notificationsChanged([
        notificationChange(offerNotification().id, null),
        notificationChange(leo.id, notificationEdge(leo, 0)),
      ]),
      errors: [
        {
          message: 'The Notification could not be read.',
          path: ['notificationsChanged', 'notifications', 0, 'edge'],
        },
      ],
    })

    await screen.findByText(ANSWER_LINE)
    expect(lines()).toEqual([ANSWER_LINE, OFFER_LINE])
  })

  it('shouldLeaveOutAChangeWhenItSortsBelowTheLoadedPages', async () => {
    const { socket } = await openWithAnOffer(
      notificationsPage([offerNotification()], { hasNextPage: true }),
    )
    const older = answerNotification({
      id: 'older',
      message: '“Lake House” accepted the Profile “Mara”.',
    })

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([
        notificationChange(older.id, notificationEdge(older, 5)),
        notificationChange(leo.id, notificationEdge(leo, 0)),
      ]),
    )

    await waitFor(() => expect(lines()).toEqual([ANSWER_LINE, OFFER_LINE]))
  })

  it('shouldListANotificationInsideTheLoadedPagesWhenItArrivesAfterTheLastLoadedOneMoved', async () => {
    const [alex, sam, mara] = ['Alex', 'Sam', 'Mara'].map(answerAbout)
    const { notifications } = notificationsPage([alex, sam], { hasNextPage: true })
    const { socket } = serve({
      notifications: {
        ...notifications,
        edges: [notificationEdge(alex, 1), notificationEdge(sam, 3)],
        pageInfo: { ...notifications.pageInfo, endCursor: 'cursor-003' },
      },
    })
    renderAppAt(NOTIFICATIONS)
    await screen.findByText(sam.message)
    await followingNotificationChanges(socket)
    // Sam's news is updated in place, so it moves to the top. The next page still starts after
    // where it was.
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(sam.id, notificationEdge(sam, 0))]),
    )
    await waitFor(() => expect(lines()).toEqual([sam.message, alex.message]))

    // Mara's news commits after the list was read, with a time between Alex's and Sam's old one.
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(mara.id, notificationEdge(mara, 2))]),
    )

    await waitFor(() => expect(lines()).toEqual([sam.message, alex.message, mara.message]))
  })

  it('shouldReadTheListAgainWhenItStartsFollowingChanges', async () => {
    const { socket } = serve()
    // Leo's news commits between the first read and the subscription, which misses it.
    const reads = answersInTurn(
      answerWith(notificationsPage([offerNotification()])),
      answerWith(notificationsPage([leo, offerNotification()], { from: 0 })),
    )
    server.use(graphql.query('Notifications', reads.resolver))
    renderAppAt(NOTIFICATIONS)

    await followingNotificationChanges(socket)

    await waitFor(() => expect(lines()).toEqual([ANSWER_LINE, OFFER_LINE]))
  })

  describe('while a read of the list is on its way', () => {
    const MARA_LINE = '“Cabin” accepted the Profile “Mara”.'

    // The list the server holds; each read answers with it as it stood when the read arrived.
    async function openWithAReadOnItsWay() {
      const held = { page: notificationsPage([offerNotification()], { from: 10 }) }
      const { socket } = serve()
      const reads = readsThatCanBeHeld(() => held.page)
      server.use(graphql.query('Notifications', reads.resolver))
      renderAppAt(NOTIFICATIONS)
      await screen.findByText(OFFER_LINE)
      await followingNotificationChanges(socket)
      // Mara's news shows that the held read has answered.
      held.page = notificationsPage([answerAbout('Mara'), offerNotification()], { from: 9 })
      const read = reads.holdNext()
      comeBackOnline()
      await read.arrived
      return { socket, release: read.release }
    }

    it('shouldKeepTheChangesThatArrivedWhenAReadSentBeforeThemAnswers', async () => {
      const { socket, release } = await openWithAReadOnItsWay()

      socket.publish(
        'NotificationsChanged',
        notificationsChanged([notificationChange(leo.id, notificationEdge(leo, 8))]),
      )
      await screen.findByText(ANSWER_LINE)
      const withdrawn = offerNotification({ resolution: 'WITHDRAWN', unread: false })
      socket.publish(
        'NotificationsChanged',
        notificationsChanged([notificationChange(withdrawn.id, notificationEdge(withdrawn, 10))]),
      )
      await screen.findByText('Withdrawn')
      release()

      await screen.findByText(MARA_LINE)
      expect(lines()).toEqual([ANSWER_LINE, MARA_LINE, OFFER_LINE])
      expect(within(rows()[2]).getByText('Withdrawn')).toBeVisible()
      expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
    })
  })
})
