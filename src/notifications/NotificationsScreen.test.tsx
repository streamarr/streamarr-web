import { act, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  NotificationsQuery,
  ProfileShareAnswer,
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
import { intersectionObserverInstances } from '../../vitest.setup'

const NOTIFICATIONS = '/notifications'
const NOTIFICATIONS_PAGE: SettingsPage = { area: 'Notifications', heading: 'Notifications' }
const HOUR = 60 * 60 * 1000
const OFFER_LINE = '“Alex” was offered to your Household.'
const ANSWER_LINE = 'The offer of “Leo” was accepted.'

/** The Notifications one mark the server took read, and on which visit. */
interface Mark {
  notificationIds: string[]
  visit: number
}

/** The server's answer to a mark: it takes from 1 to 100 ids and refuses any other number. */
function markAnswer(notificationIds: readonly string[]) {
  const refused = notificationIds.length < 1 || notificationIds.length > 100
  return {
    markNotificationsRead: {
      __typename: 'MarkNotificationsReadPayload',
      unreadNotificationCount: refused ? null : 0,
      userErrors: refused
        ? [
            {
              __typename: 'NotificationIdCountOutOfRangeError',
              message: 'Send from 1 to 100 Notification ids.',
            },
          ]
        : [],
    },
  }
}

function serve(page: NotificationsQuery = notificationsPage([]), me = meFixture()) {
  const socket = serveGraphqlSocket()
  const marks: Mark[] = []
  const visits = { count: 1 }
  const list = { reads: 0 }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('Notifications', () => {
      list.reads += 1
      return HttpResponse.json({ data: page })
    }),
    graphql.mutation('MarkNotificationsRead', ({ variables }) => {
      const { notificationIds } = (variables as { input: { notificationIds: string[] } }).input
      const answer = markAnswer(notificationIds)
      if (answer.markNotificationsRead.userErrors.length === 0) {
        marks.push({ notificationIds, visit: visits.count })
      }
      return HttpResponse.json({ data: answer })
    }),
  )
  return { socket, marks, visits, list }
}

function markAllRead(user: UserEvent) {
  return user.click(screen.getByRole('button', { name: 'Mark all as read' }))
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
    message: `The offer of “${name}” was accepted.`,
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

type NotificationNode = Parameters<typeof notificationEdge>[0] & object

/**
 * Serves the list as the server holds `nodes`, newest first: `first` rows, or 20 when a read does
 * not ask, after the place that `after` names. Like the server, it refuses a read of more than 500
 * rows. Each Notification keeps its place in the list. A test takes one out, changes it or puts
 * news first, where the server would, and tells the page nothing.
 */
function serveTheHeldList(nodes: NotificationNode[]) {
  const held = new Map(nodes.map((node, index) => [node.id, notificationEdge(node, index + 1)!]))
  server.use(
    graphql.query('Notifications', ({ variables }) => {
      const { first, after } = variables as { first?: number | null; after?: string | null }
      if (first && first > 500) {
        return HttpResponse.json({ errors: [{ message: 'first must not exceed 500.' }] })
      }
      const edges = [...held.values()].filter((edge) => !after || edge.cursor > after)
      const page = edges.slice(0, first ?? 20)
      return HttpResponse.json({
        data: {
          notifications: {
            __typename: 'NotificationConnection',
            edges: page,
            pageInfo: {
              __typename: 'PageInfo',
              hasNextPage: page.length < edges.length,
              endCursor: page.at(-1)?.cursor ?? null,
            },
          },
        },
      })
    }),
  )
  return {
    remove: (id: string) => held.delete(id),
    replace: (node: NotificationNode) => {
      const at = Number(held.get(node.id)!.cursor.slice('cursor-'.length))
      held.set(node.id, notificationEdge(node, at)!)
    },
    arrive: (node: NotificationNode) => {
      const before = [...held]
      held.clear()
      held.set(node.id, notificationEdge(node, 0)!)
      for (const [id, edge] of before) held.set(id, edge)
    },
  }
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
        answerNotification({ message: 'The offer of “<b>Leo</b>” was accepted.' }),
      ]),
    )
    renderAppAt(NOTIFICATIONS)

    await screen.findByText('“Alex” was offered to your Household.')

    expect(rows().map((row) => row.querySelector('p')?.textContent)).toEqual([
      '“Alex” was offered to your Household.',
      'The offer of “<b>Leo</b>” was accepted.',
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

  it.each<[RequestResolution, ProfileShareAnswer | null, string, string]>([
    ['DECIDED', 'ACCEPTED', 'The offer of “Alex” to your Household was accepted.', 'Accepted'],
    ['DECIDED', 'REJECTED', 'The offer of “Alex” to your Household was declined.', 'Declined'],
    ['WITHDRAWN', null, 'The offer of “Alex” to your Household was withdrawn.', 'Withdrawn'],
    ['EXPIRED', null, 'The offer of “Alex” to your Household expired.', 'Expired'],
  ])(
    'shouldSayHowAnOfferEndedInPlaceOfReviewWhenItResolved: %s with the answer %s',
    async (resolution, answer, line, ending) => {
      serve(notificationsPage([offerNotification({ resolution, answer })]))
      renderAppAt(NOTIFICATIONS)

      await screen.findByText(line)

      expect(within(rows()[0]).getByText(ending)).toBeVisible()
      expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
    },
  )

  it.each<[string, ProfileShareAnswer | null]>([
    ['none', null],
    ['one added after this client', 'POSTPONED' as ProfileShareAnswer],
  ])(
    'shouldSayNothingOfHowAnOfferWasDecidedWhenItCarriesNoAnswerThisClientKnows: %s',
    async (_, answer) => {
      serve(notificationsPage([offerNotification({ resolution: 'DECIDED', answer })]))
      renderAppAt(NOTIFICATIONS)

      await screen.findByRole('list', { name: 'Notifications' })

      expect(
        within(rows()[0]).queryByText(/^(Accepted|Declined|Withdrawn|Expired)$/),
      ).not.toBeInTheDocument()
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

  it('shouldSayHowAnOfferWasDecidedWhenTheDecisionArrivesAfterItShowedExpired', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
    onTestFinished(() => void vi.useRealTimers())
    const expiresAt = new Date(Date.now() + HOUR).toISOString()
    const { socket } = serve(notificationsPage([offerNotification({ expiresAt })]))
    renderAppAt(NOTIFICATIONS)
    await screen.findByRole('link', { name: 'Review' })
    await followingNotificationChanges(socket)
    await act(() => vi.advanceTimersByTimeAsync(HOUR))
    await within(rows()[0]).findByText('Expired')

    // The offer was accepted before its expiry, and the change arrives after it.
    const accepted = offerNotification({ expiresAt, resolution: 'DECIDED', answer: 'ACCEPTED' })
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(accepted.id, notificationEdge(accepted, 1))]),
    )

    expect(await within(rows()[0]).findByText('Accepted')).toBeVisible()
    expect(within(rows()[0]).queryByText('Expired')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
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

  it('shouldMarkNothingReadWhenTheListOpens', async () => {
    const { socket, marks, list } = serve(
      notificationsPage([offerNotification(), answerNotification({ unread: true })]),
    )
    renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)
    await followingNotificationChanges(socket)

    // Once it follows changes, the page reads the list again: a mark sent on opening went before.
    await waitFor(() => expect(list.reads).toBe(2))
    expect(marks).toEqual([])
    expect(rows().map((row) => within(row).queryByTestId('unread-mark') !== null)).toEqual([
      true,
      true,
    ])
  })

  it('shouldMarkReadEveryUnreadNotificationThePageShowsWhenThePersonMarksThemAll', async () => {
    const mara = answerNotification({
      id: 'answer-for-mara',
      message: 'The offer of “Mara” was accepted.',
      unread: true,
    })
    const { marks } = serve(
      notificationsPage([offerNotification(), answerNotification(), mara], { hasNextPage: true }),
    )
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)

    await markAllRead(user)

    await waitFor(() =>
      expect(marks).toEqual([{ notificationIds: ['offer-of-alex', 'answer-for-mara'], visit: 1 }]),
    )
  })

  it('shouldMarkEveryUnreadNotificationWhenThePersonMarksAllOfMoreThanAHundred', async () => {
    const unread = Array.from({ length: 101 }, (_, index) =>
      answerNotification({
        id: `answer-${index}`,
        message: `The offer of “Profile ${index}” was accepted.`,
        unread: true,
      }),
    )
    const { marks } = serve(notificationsPage(unread))
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Profile 100” was accepted.')

    await markAllRead(user)

    await waitFor(() =>
      expect(marks.flatMap((mark) => mark.notificationIds)).toEqual(unread.map(({ id }) => id)),
    )
  })

  it('shouldSendTheNextCallOfMarkingAllWhenAnEarlierOneFails', async () => {
    const unread = Array.from({ length: 101 }, (_, index) =>
      answerNotification({
        id: `answer-${index}`,
        message: `The offer of “Profile ${index}” was accepted.`,
        unread: true,
      }),
    )
    const { marks } = serve(notificationsPage(unread))
    const calls = { count: 0 }
    server.use(
      graphql.mutation('MarkNotificationsRead', () => {
        calls.count += 1
        // The first call, of the first 100, never reaches the server.
        return calls.count === 1 ? HttpResponse.error() : undefined
      }),
    )
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Profile 100” was accepted.')

    await markAllRead(user)

    await waitFor(() => expect(marks).toEqual([{ notificationIds: ['answer-100'], visit: 1 }]))
  })

  it.each([
    ['cannot reach the server', () => HttpResponse.error(), "Couldn't mark notifications as read."],
    [
      'refuses the ids',
      () =>
        HttpResponse.json({
          data: {
            markNotificationsRead: {
              __typename: 'MarkNotificationsReadPayload',
              unreadNotificationCount: null,
              userErrors: [{ __typename: 'InvalidIdError', message: 'The id is not valid.' }],
            },
          },
        }),
      'The id is not valid.',
    ],
  ])('shouldSayWhyUnderMarkAllAsReadWhenTheMark %s', async (_, answer, words) => {
    serve(notificationsPage([offerNotification(), answerNotification({ unread: true })]))
    server.use(graphql.mutation('MarkNotificationsRead', answer))
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)

    await markAllRead(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(words)
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toHaveAccessibleDescription(
      words,
    )
    expect(screen.getAllByTestId('unread-mark')).toHaveLength(2)
  })

  it('shouldClearTheReasonWhenThePersonMarksThemAllAgain', async () => {
    const { marks } = serve(
      notificationsPage([offerNotification(), answerNotification({ unread: true })]),
    )
    const calls = { count: 0 }
    server.use(
      graphql.mutation('MarkNotificationsRead', () => {
        calls.count += 1
        return calls.count === 1 ? HttpResponse.error() : undefined
      }),
    )
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)
    await markAllRead(user)
    await screen.findByRole('alert')

    await markAllRead(user)

    await waitFor(() => expect(marks).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  /**
   * Serves `nodes` as the list, and holds each of them as read once a mark goes out, as the server
   * does. A test publishes no change, so the page hears of the mark only in its answer.
   */
  function serveAMarkThatNoChangeTells(nodes: NotificationNode[]) {
    const held = { page: notificationsPage(nodes) }
    server.use(
      graphql.query('Notifications', () => HttpResponse.json({ data: held.page })),
      graphql.mutation('MarkNotificationsRead', () => {
        held.page = notificationsPage(nodes.map((node) => ({ ...node, unread: false })))
      }),
    )
  }

  it('shouldShowTheNotificationsReadWhenTheMarkSucceedsAndNoChangeSaysSo', async () => {
    const { marks } = serve()
    serveAMarkThatNoChangeTells([offerNotification(), answerNotification({ unread: true })])
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)

    await markAllRead(user)

    await waitFor(() => expect(marks).toHaveLength(1))
    await waitFor(() => expect(screen.queryByTestId('unread-mark')).not.toBeInTheDocument())
    expect(screen.queryByText('Unread')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument()
  })

  it('shouldMoveFocusToTheHeadingWhenMarkingAllLeavesNothingUnread', async () => {
    serve()
    serveAMarkThatNoChangeTells([answerNotification({ unread: true })])
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(ANSWER_LINE)

    await markAllRead(user)

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toHaveFocus(),
    )
  })

  it('shouldLeaveUnreadTheNotificationsOfACallThatFailedWhenTheNextCallOfMarkingAllSucceeds', async () => {
    const unread = Array.from({ length: 101 }, (_, index) =>
      answerNotification({
        id: `answer-${index}`,
        message: `The offer of “Profile ${index}” was accepted.`,
        unread: true,
      }),
    )
    const { marks } = serve(notificationsPage(unread))
    const calls = { count: 0 }
    server.use(
      graphql.mutation('MarkNotificationsRead', () => {
        calls.count += 1
        // The first call, of the first 100, never reaches the server.
        return calls.count === 1 ? HttpResponse.error() : undefined
      }),
    )
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Profile 100” was accepted.')

    await markAllRead(user)

    await waitFor(() => expect(marks).toEqual([{ notificationIds: ['answer-100'], visit: 1 }]))
    const last = rows().at(-1)!
    await waitFor(() => expect(within(last).queryByTestId('unread-mark')).not.toBeInTheDocument())
    expect(screen.getAllByTestId('unread-mark')).toHaveLength(100)
  })

  it('shouldClearTheUnreadMarksWhenAMarkMadeElsewhereReadsThem', async () => {
    const { socket } = serve(
      notificationsPage([offerNotification(), answerNotification({ unread: true })]),
    )
    renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)
    await followingNotificationChanges(socket)

    // The server tells every socket of the Account that a mark another session sent read them.
    const offer = offerNotification({ unread: false })
    const leo = answerNotification({ unread: false })
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([
        notificationChange(offer.id, notificationEdge(offer, 1)),
        notificationChange(leo.id, notificationEdge(leo, 2)),
      ]),
    )

    await waitFor(() => expect(screen.queryByTestId('unread-mark')).not.toBeInTheDocument())
    expect(screen.queryByText('Unread')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument()
  })

  it('shouldMarkARequestReadWhenThePersonOpensItToReview', async () => {
    const { marks } = serve(
      notificationsPage([offerNotification(), answerNotification({ unread: true })]),
    )
    const { user, router } = renderAppAt(NOTIFICATIONS)

    await user.click(await screen.findByRole('link', { name: 'Review' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Share offers' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/settings/household/offers')
    await waitFor(() => expect(marks).toEqual([{ notificationIds: ['offer-of-alex'], visit: 1 }]))
  })
})

describe('Older Notifications', () => {
  const NEWEST = notificationsPage([answerAbout('Alex'), answerAbout('Sam')], { hasNextPage: true })
  const OLDER = notificationsPage([answerAbout('Mara'), answerAbout('Leo')], { from: 3 })

  it('shouldLoadOlderNotificationsWhenTheEndOfTheListComesIntoView', async () => {
    serve()
    const reads = servePages(NEWEST, OLDER)
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Alex” was accepted.')

    await reachTheEndOfTheList()

    await screen.findByText('The offer of “Leo” was accepted.')
    expect(lines()).toEqual([
      'The offer of “Alex” was accepted.',
      'The offer of “Sam” was accepted.',
      'The offer of “Mara” was accepted.',
      'The offer of “Leo” was accepted.',
    ])
    expect(reads).toContain('cursor-002')
    expect(screen.queryByTestId('older-notifications')).not.toBeInTheDocument()
  })

  it('shouldMarkReadTheUnreadNotificationsOfAnOlderPageWhenThePersonMarksAllAfterItJoined', async () => {
    const { marks } = serve()
    const mara = answerNotification({
      id: 'answer-for-mara',
      message: 'The offer of “Mara” was accepted.',
      unread: true,
    })
    servePages(NEWEST, notificationsPage([mara, answerAbout('Leo')], { from: 3 }))
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Alex” was accepted.')
    await reachTheEndOfTheList()
    await screen.findByText('The offer of “Mara” was accepted.')

    await markAllRead(user)

    await waitFor(() => expect(marks).toEqual([{ notificationIds: ['answer-for-mara'], visit: 1 }]))
  })

  it('shouldLoadOlderNotificationsWhenTheNewestPageHasNoneToShow', async () => {
    serve()
    servePages(
      notificationsPage([null], { hasNextPage: true }),
      notificationsPage([answerAbout('Mara'), answerAbout('Leo')], { from: 2 }),
    )
    renderAppAt(NOTIFICATIONS)

    await reachTheEndOfTheList()

    await screen.findByText('The offer of “Leo” was accepted.')
    expect(lines()).toEqual([
      'The offer of “Mara” was accepted.',
      'The offer of “Leo” was accepted.',
    ])
    expect(screen.queryByText('No notifications.')).not.toBeInTheDocument()
  })

  it('shouldShowANotificationOnceWhenTheOlderPageRepeatsOneItShows', async () => {
    serve()
    servePages(NEWEST, notificationsPage([answerAbout('Sam'), answerAbout('Leo')], { from: 3 }))
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Alex” was accepted.')

    await reachTheEndOfTheList()

    await screen.findByText('The offer of “Leo” was accepted.')
    expect(lines()).toEqual([
      'The offer of “Alex” was accepted.',
      'The offer of “Sam” was accepted.',
      'The offer of “Leo” was accepted.',
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
    await screen.findByText('The offer of “Alex” was accepted.')

    await reachTheEndOfTheList()

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load older notifications.")
    expect(lines()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('The offer of “Leo” was accepted.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // More than the newest page of the server's 20 holds, so that the list loads an older page.
  const TWENTY_TWO = Array.from({ length: 22 }, (_, index) => answerAbout(`Profile ${index + 1}`))

  it('shouldKeepTheOlderNotificationsItLoadedWhenTheListIsReadAgain', async () => {
    serve()
    const held = serveTheHeldList(TWENTY_TWO)
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Profile 1” was accepted.')
    await reachTheEndOfTheList()
    await screen.findByText('The offer of “Profile 22” was accepted.')

    // Profile 1's line changes while the page misses changes, so the answer of the read shows.
    held.replace(
      answerNotification({
        id: 'answer-for-Profile 1',
        message: 'The offer of “Profile 1” was declined.',
      }),
    )
    comeBackOnline()

    await screen.findByText('The offer of “Profile 1” was declined.')
    expect(lines()).toEqual([
      'The offer of “Profile 1” was declined.',
      ...TWENTY_TWO.slice(1).map(({ message }) => message),
    ])
  })

  it('shouldDropANotificationOfAnOlderPageWhenTheListReadAgainNoLongerHasIt', async () => {
    serve()
    const held = serveTheHeldList(TWENTY_TWO)
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Profile 1” was accepted.')
    await reachTheEndOfTheList()
    await screen.findByText('The offer of “Profile 22” was accepted.')

    // Retention deletes the news about Profile 21, which no change tells the page.
    held.remove('answer-for-Profile 21')
    comeBackOnline()

    await waitFor(() =>
      expect(lines()).toEqual(
        TWENTY_TWO.filter(({ id }) => id !== 'answer-for-Profile 21').map(({ message }) => message),
      ),
    )
  })

  it('shouldSayHowAnOlderRequestEndedWhenTheListReadAgainSaysSo', async () => {
    serve()
    const waiting = offerNotification({ unread: false })
    const held = serveTheHeldList([...TWENTY_TWO.slice(0, 20), waiting])
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Profile 1” was accepted.')
    await reachTheEndOfTheList()
    await screen.findByRole('link', { name: 'Review' })

    // The offer is withdrawn while the page misses changes.
    held.replace(offerNotification({ resolution: 'WITHDRAWN' }))
    comeBackOnline()

    expect(await within(rows()[20]).findByText('Withdrawn')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
  })

  // More than the newest page holds, so that 5 rows stay on the older page.
  const TWENTY_FIVE = Array.from({ length: 25 }, (_, index) => answerAbout(`Profile ${index + 1}`))

  it('shouldDropTheLastNotificationShownWhenItWasDeletedWhileNewsArrivedUnseen', async () => {
    serve()
    const held = serveTheHeldList(TWENTY_FIVE)
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Profile 20” was accepted.')

    // While the page misses changes, Tom's news arrives and the news about Profile 20 is deleted.
    held.arrive(answerAbout('Tom'))
    held.remove('answer-for-Profile 20')
    comeBackOnline()

    await screen.findByText('The offer of “Tom” was accepted.')
    expect(lines()).toEqual([
      'The offer of “Tom” was accepted.',
      ...TWENTY_FIVE.slice(0, 19).map(({ message }) => message),
    ])
  })

  it('shouldLoadAgainTheNotificationThatNewsPushedPastTheReadWhenTheEndOfTheListComesIntoView', async () => {
    serve()
    const held = serveTheHeldList(TWENTY_FIVE)
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Profile 20” was accepted.')
    // Tom's news arrives while the page misses changes, so the read again ends at Profile 19.
    held.arrive(answerAbout('Tom'))
    comeBackOnline()
    await screen.findByText('The offer of “Tom” was accepted.')

    await reachTheEndOfTheList()

    await screen.findByText('The offer of “Profile 25” was accepted.')
    expect(lines()).toEqual([
      'The offer of “Tom” was accepted.',
      ...TWENTY_FIVE.map(({ message }) => message),
    ])
  })

  // Loading 520 rows, 20 at a time, takes about 4 s with coverage, near the default limit of 5 s.
  it('shouldDropANotificationBeyondTheFiveHundredthWhenTheListReadAgainNoLongerHasIt', async () => {
    serve()
    const many = Array.from({ length: 520 }, (_, index) => answerAbout(`Profile ${index + 1}`))
    const held = serveTheHeldList(many)
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Profile 20” was accepted.')
    for (let shown = 40; shown <= 520; shown += 20) {
      await reachTheEndOfTheList()
      await waitFor(() => expect(screen.getAllByTestId('notification-text')).toHaveLength(shown))
    }

    // Retention deletes the news about Profile 510, and Profile 1's line changes so the read shows.
    held.remove('answer-for-Profile 510')
    held.replace(
      answerNotification({
        id: 'answer-for-Profile 1',
        message: 'The offer of “Profile 1” was declined.',
      }),
    )
    comeBackOnline()

    await screen.findByText('The offer of “Profile 1” was declined.')
    expect(screen.queryByText('The offer of “Profile 510” was accepted.')).not.toBeInTheDocument()
  }, 15_000)

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
    await screen.findByText('The offer of “Alex” was accepted.')
    await followingNotificationChanges(socket)
    await reachTheEndOfTheList()
    await waitFor(() => expect(older.calls).toBe(1))

    // Sam's news and everything older were deleted, which no change says: the list read again ends
    // at Alex, and only then does the older page asked for after Sam answer.
    newest.page = notificationsPage([answerAbout('Alex')])
    comeBackOnline()
    await waitFor(() => expect(lines()).toEqual(['The offer of “Alex” was accepted.']))
    const answered = answerDelivered('Notifications')
    late.release()
    await answered
    // News that arrives after the older page answered: once it shows, that answer was handled.
    const sentinel = answerNotification({
      id: 'answer-for-sam',
      message: 'The offer of “Sam” was declined.',
    })
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(sentinel.id, notificationEdge(sentinel, 0))]),
    )
    await screen.findByText('The offer of “Sam” was declined.')

    expect(lines()).toEqual([
      'The offer of “Sam” was declined.',
      'The offer of “Alex” was accepted.',
    ])
  })

  it('shouldKeepOutANotificationDismissedWhileTheOlderPageThatHoldsItIsOnItsWay', async () => {
    const { socket } = serve()
    const late = heldAnswer(OLDER)
    onTestFinished(late.release)
    const older = { calls: 0 }
    server.use(
      graphql.query('Notifications', ({ variables }) => {
        if (!(variables as { after?: string | null }).after) {
          return HttpResponse.json({ data: NEWEST })
        }
        older.calls += 1
        return late.answer()
      }),
    )
    renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Alex” was accepted.')
    await followingNotificationChanges(socket)
    await reachTheEndOfTheList()
    await waitFor(() => expect(older.calls).toBe(1))

    // Mara's news is dismissed in the change that brings Tom's, which shows that it has arrived.
    const tom = answerAbout('Tom')
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([
        notificationChange('answer-for-Mara', null),
        notificationChange(tom.id, notificationEdge(tom, 0)),
      ]),
    )
    await screen.findByText('The offer of “Tom” was accepted.')
    late.release()

    await screen.findByText('The offer of “Leo” was accepted.')
    expect(lines()).toEqual([
      'The offer of “Tom” was accepted.',
      'The offer of “Alex” was accepted.',
      'The offer of “Sam” was accepted.',
      'The offer of “Leo” was accepted.',
    ])
  })

  it('shouldAddNoOlderPageWhenItArrivesAfterThePersonLeft', async () => {
    serve()
    servePages(NEWEST, notificationsPage([answerAbout('Mara')], { from: 3 }))
    const late = heldAnswer(OLDER)
    onTestFinished(late.release)
    const firstOlder = { calls: 0 }
    server.use(
      graphql.query('Notifications', ({ variables }) => {
        if (!(variables as { after?: string | null }).after || firstOlder.calls > 0) return
        firstOlder.calls += 1
        return late.answer()
      }),
    )
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Alex” was accepted.')
    await reachTheEndOfTheList()
    await waitFor(() => expect(firstOlder.calls).toBe(1))
    await leaveForHome(user, NOTIFICATIONS_PAGE)
    await returnThroughTheProfileMenu(user, NOTIFICATIONS_PAGE)
    await screen.findByText('The offer of “Alex” was accepted.')

    const answered = answerDelivered('Notifications')
    late.release()
    await answered
    await reachTheEndOfTheList()

    await screen.findByText('The offer of “Mara” was accepted.')
    expect(lines()).toEqual([
      'The offer of “Alex” was accepted.',
      'The offer of “Sam” was accepted.',
      'The offer of “Mara” was accepted.',
    ])
  })

  it('shouldShowOnlyTheNewestPageWhenThePersonReturns', async () => {
    serve()
    servePages(NEWEST, OLDER)
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText('The offer of “Alex” was accepted.')
    await reachTheEndOfTheList()
    await screen.findByText('The offer of “Leo” was accepted.')

    await leaveForHome(user, NOTIFICATIONS_PAGE)
    await returnThroughTheProfileMenu(user, NOTIFICATIONS_PAGE)

    await screen.findByText('The offer of “Alex” was accepted.')
    expect(lines()).toEqual([
      'The offer of “Alex” was accepted.',
      'The offer of “Sam” was accepted.',
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

  it('shouldListANotificationFirstOnceWithItsNewLineWhenItIsUpdatedInPlace', async () => {
    const { socket, user } = await openWithAnOffer(notificationsPage([offerNotification(), leo]))

    // No sharing kind is told twice about one subject, so news of an answer stands in for a kind
    // that is: the change keeps the Notification's id and gives it a new line and a newer time.
    const updated = answerNotification({
      unread: true,
      message: 'The offer of “Leon” was accepted.',
      latestEventAt: new Date().toISOString(),
    })
    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(leo.id, notificationEdge(updated, 0))], 3),
    )

    await waitFor(() => expect(lines()).toEqual(['The offer of “Leon” was accepted.', OFFER_LINE]))
    expect(within(rows()[0]).getByText('Just now')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /^Profile menu/ }))
    const menu = within(await screen.findByTestId('profile-menu'))
    expect(menu.getByRole('button', { name: 'Notifications, 3 unread' })).toBeVisible()
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
    const accepted = offerNotification({ resolution: 'DECIDED', answer: 'ACCEPTED' })

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(accepted.id, notificationEdge(accepted, 1))]),
    )

    await within(rows()[0]).findByText('Accepted')
    await expectFocusOnTheHeading()
  })

  it('shouldMoveFocusToTheHeadingWhenTheNotificationThePersonIsOnIsDismissed', async () => {
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
    const accepted = offerNotification({ resolution: 'DECIDED', answer: 'ACCEPTED' })

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(accepted.id, notificationEdge(accepted, 1))]),
    )

    expect(await within(rows()[0]).findByText('Accepted')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
    // A request that resolved counts as read.
    expect(within(rows()[0]).queryByText('Unread')).not.toBeInTheDocument()
  })

  it('shouldTakeANotificationOutWhenItIsDismissed', async () => {
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
      message: 'The offer of “Mara” was accepted.',
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
    const MARA_LINE = 'The offer of “Mara” was accepted.'

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
      const withdrawn = offerNotification({ resolution: 'WITHDRAWN' })
      socket.publish(
        'NotificationsChanged',
        notificationsChanged([notificationChange(withdrawn.id, notificationEdge(withdrawn, 10))]),
      )
      await screen.findByText('Withdrawn')
      release()

      await screen.findByText(MARA_LINE)
      expect(lines()).toEqual([ANSWER_LINE, MARA_LINE, withdrawn.message])
      expect(within(rows()[2]).getByText('Withdrawn')).toBeVisible()
      expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
    })

    it('shouldKeepOutANotificationDismissedWhileAReadSentBeforeItIsOnItsWay', async () => {
      const { socket, release } = await openWithAReadOnItsWay()

      socket.publish(
        'NotificationsChanged',
        notificationsChanged([notificationChange(offerNotification().id, null)]),
      )
      await screen.findByText('No notifications.')
      release()

      await screen.findByText(MARA_LINE)
      expect(lines()).toEqual([MARA_LINE])
    })
  })
})
