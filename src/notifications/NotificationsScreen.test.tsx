import { act, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  NotificationsQuery,
  ProfileShareAnswer,
  RequestResolution,
} from '../graphql/generated/graphql'
import {
  answersInTurn,
  answerWith,
  comeBackOnline,
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
const OFFER_LINE = '“Sam” offered the Profile “Alex” to your Household.'
const ANSWER_LINE = '“Cabin” accepted the Profile “Leo”.'

interface Mark {
  notificationIds: string[]
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
    graphql.mutation('MarkNotificationsRead', ({ variables }) => {
      const { notificationIds } = (variables as { input: { notificationIds: string[] } }).input
      marks.push({ notificationIds, visit: visits.count })
      return HttpResponse.json({
        data: {
          markNotificationsRead: {
            __typename: 'MarkNotificationsReadPayload',
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
  it('shouldOpenNotificationsFromTheProfileMenu', async () => {
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
    expect(screen.queryByTestId('home-ambient')).not.toBeInTheDocument()
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

  it.each<[RequestResolution, ProfileShareAnswer | null, string]>([
    ['DECIDED', 'ACCEPTED', 'Accepted'],
    ['DECIDED', 'REJECTED', 'Declined'],
    ['WITHDRAWN', null, 'Withdrawn'],
    ['EXPIRED', null, 'Expired'],
  ])(
    'shouldSayHowAnOfferEndedInPlaceOfReviewWhenItResolved: %s with answer %s',
    async (resolution, answer, ending) => {
      serve(
        notificationsPage([
          offerNotification({
            unread: false,
            resolution,
            answer,
          }),
        ]),
      )
      renderAppAt(NOTIFICATIONS)

      await screen.findByText(OFFER_LINE)

      expect(within(rows()[0]).getByText(ending)).toBeVisible()
      expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
    },
  )

  it('shouldSayHowLongAgoAsTimePassesWithThePageOpen', async () => {
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
    expect(screen.queryByText('Unread')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument()
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

  it('shouldMarkNothingReadWhenTheListOpens', async () => {
    const page = notificationsPage([offerNotification(), answerNotification({ unread: true })])
    const { socket, marks } = serve(page)
    let reads = 0
    server.use(
      graphql.query('Notifications', () => {
        reads += 1
        return HttpResponse.json({ data: page })
      }),
    )
    renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)
    await followingNotificationChanges(socket)

    await waitFor(() => expect(reads).toBe(2))

    expect(marks).toEqual([])
    expect(rows().every((row) => within(row).queryByTestId('unread-mark') !== null)).toBe(true)
  })

  it('shouldMarkOnlyTheOpenedRequestReadWhenTheReaderChoosesReview', async () => {
    server.use(
      graphql.query('ShareOffers', () =>
        HttpResponse.json({ data: { householdShares: { edges: [] } } }),
      ),
    )
    const { marks } = serve(
      notificationsPage([offerNotification(), answerNotification({ unread: true })]),
    )
    const { user, router } = renderAppAt(NOTIFICATIONS)

    await user.click(await screen.findByRole('link', { name: 'Review' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/household/offers'))
    await waitFor(() => expect(marks).toEqual([{ notificationIds: ['offer-of-alex'], visit: 1 }]))
  })

  it('shouldMarkOnlyShownUnreadNotificationsWhenThePersonMarksThemAll', async () => {
    const page = notificationsPage(
      [
        offerNotification(),
        answerNotification(),
        answerNotification({ id: 'answer-for-mara', unread: true }),
      ],
      { hasNextPage: true },
    )
    serve(page)
    const marked: string[][] = []
    server.use(
      graphql.mutation('MarkNotificationsRead', ({ variables }) => {
        marked.push((variables as { input: { notificationIds: string[] } }).input.notificationIds)
        return HttpResponse.json({
          data: {
            markNotificationsRead: {
              __typename: 'MarkNotificationsReadPayload',
              unreadNotificationCount: 0,
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))

    await waitFor(() => expect(marked).toEqual([['offer-of-alex', 'answer-for-mara']]))
  })
  it('shouldShowNotificationsReadWhenTheMarkSucceedsWithoutASocketChange', async () => {
    serve(notificationsPage([offerNotification(), answerNotification({ unread: true })]))
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))

    await waitFor(() => expect(screen.queryAllByText('Unread')).toHaveLength(0))
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument()
    expect(lines()).toEqual([OFFER_LINE, ANSWER_LINE])
  })

  it.each([
    {
      failure: 'a refusal',
      answer: () =>
        HttpResponse.json({
          data: {
            markNotificationsRead: {
              __typename: 'MarkNotificationsReadPayload',
              unreadNotificationCount: 2,
              userErrors: [
                {
                  __typename: 'NotificationIdCountOutOfRangeError',
                  message: 'Choose fewer notifications.',
                  inputPath: ['notificationIds'],
                },
              ],
            },
          },
        }),
      message: 'Choose fewer notifications.',
    },
    {
      failure: 'a network failure',
      answer: () => HttpResponse.error(),
      message: "Couldn't mark notifications as read.",
    },
  ])(
    'shouldKeepNotificationsUnreadAndAllowAnotherMarkWhenThereIs $failure',
    async ({ answer, message }) => {
      serve(notificationsPage([offerNotification(), answerNotification({ unread: true })]))
      server.use(graphql.mutation('MarkNotificationsRead', answer, { once: true }))
      const { user } = renderAppAt(NOTIFICATIONS)
      await screen.findByText(OFFER_LINE)

      await user.click(screen.getByRole('button', { name: 'Mark all as read' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getAllByText('Unread')).toHaveLength(2)

      await user.click(screen.getByRole('button', { name: 'Mark all as read' }))

      await waitFor(() => expect(screen.queryAllByText('Unread')).toHaveLength(0))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('shouldMarkEveryLoadedNotificationInBatchesOfAtMostOneHundredWhenTheReaderMarksAll', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      answerNotification({ id: `news-${index + 1}`, message: `News ${index + 1}`, unread: true }),
    )
    const { marks } = serve()
    servePages(
      notificationsPage(firstPage, { hasNextPage: true }),
      notificationsPage(
        [answerNotification({ id: 'news-101', message: 'News 101', unread: true })],
        { from: 101 },
      ),
    )
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText('News 100')
    await reachTheEndOfTheList()
    await screen.findByText('News 101')

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))

    await waitFor(() =>
      expect(marks.map(({ notificationIds }) => notificationIds.length)).toEqual([100, 1]),
    )
    expect(new Set(marks.flatMap(({ notificationIds }) => notificationIds)).size).toBe(101)
    expect(marks[0].notificationIds[0]).toBe('news-1')
    expect(marks[0].notificationIds[99]).toBe('news-100')
    expect(marks[1].notificationIds).toEqual(['news-101'])
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
     * at the server. Mara's news is read elsewhere before the person returns to this page.
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

    // The current visit sees the stored read state of the older page.
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
      answer: 'ACCEPTED',
    })

    socket.publish(
      'NotificationsChanged',
      notificationsChanged([notificationChange(accepted.id, notificationEdge(accepted, 1))]),
    )

    expect(await within(rows()[0]).findByText('Accepted')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Review' })).not.toBeInTheDocument()
    expect(within(rows()[0]).queryByText('Unread')).not.toBeInTheDocument()
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

  it('shouldKeepANotificationWhoseChangeCameWithAnError', async () => {
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

  it('shouldLeaveOutAChangeBelowTheLoadedPages', async () => {
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

  it('shouldReadTheListAgainOnceItFollowsChanges', async () => {
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
