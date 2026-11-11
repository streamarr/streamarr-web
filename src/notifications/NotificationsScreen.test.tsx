import { act, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  NotificationsQuery,
  ProfileShareStatus,
  RequestResolution,
} from '../graphql/generated/graphql'
import { comeBackOnline, failsOnceThen } from '../test/graphqlResponses'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { meFixture } from '../test/meFixture'
import {
  answerNotification,
  hoursAgo,
  notificationsPage,
  offerNotification,
} from '../test/notificationFixtures'
import { renderAppAt } from '../test/render'
import { leaveForHome, returnThroughTheProfileMenu, type SettingsPage } from '../test/returnVisits'
import { server } from '../test/server'
import homeShellStyles from '../ui/HomeShell.module.css'
import { intersectionObserverInstances } from '../../vitest.setup'

const NOTIFICATIONS = '/notifications'
const NOTIFICATIONS_PAGE: SettingsPage = { area: 'Notifications', heading: 'Notifications' }
const HOUR = 60 * 60 * 1000
const OFFER_LINE = '“Sam” offered the Profile “Alex” to your Household.'
const ANSWER_LINE = '“Cabin” accepted the Profile “Leo”.'

/** Each time the page marked the list read: through which cursor, and on which visit. */
interface Mark {
  through: string
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
    graphql.mutation('MarkAllNotificationsRead', ({ variables }) => {
      const { through } = (variables as { input: { through: string } }).input
      marks.push({ through, visit: visits.count })
      return HttpResponse.json({
        data: {
          markAllNotificationsRead: {
            __typename: 'MarkAllNotificationsReadPayload',
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
    expect(document.querySelector(`.${homeShellStyles.homeAmbient}`)).toBeNull()
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

  it('shouldOfferRetryWhenTheListCannotLoad', async () => {
    serve()
    const list = failsOnceThen(notificationsPage([offerNotification()]))
    server.use(graphql.query('Notifications', list.resolver))
    const { user } = renderAppAt(NOTIFICATIONS)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load notifications.")
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(
      await screen.findByText('“Sam” offered the Profile “Alex” to your Household.'),
    ).toBeVisible()
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

  it('shouldMarkWhatThePageShowsAsReadOnceTheListHasRendered', async () => {
    const { marks } = serve(notificationsPage([offerNotification(), answerNotification()]))
    renderAppAt(NOTIFICATIONS)

    await screen.findByText(OFFER_LINE)

    await waitFor(() => expect(marks).toEqual([{ through: 'cursor-001', visit: 1 }]))
  })

  it('shouldLeaveANotificationThatArrivesAfterOpeningUnreadUntilTheNextVisit', async () => {
    const held = { page: notificationsPage([offerNotification({ unread: false })]) }
    const { marks, visits } = serve()
    server.use(graphql.query('Notifications', () => HttpResponse.json({ data: held.page })))
    const { user } = renderAppAt(NOTIFICATIONS)
    await screen.findByText(OFFER_LINE)
    await waitFor(() => expect(marks).toHaveLength(1))

    held.page = notificationsPage(
      [answerNotification({ unread: true }), offerNotification({ unread: false })],
      { from: 0 },
    )
    comeBackOnline()
    await screen.findByText(ANSWER_LINE)
    await leaveForHome(user, NOTIFICATIONS_PAGE)
    visits.count = 2
    await returnThroughTheProfileMenu(user, NOTIFICATIONS_PAGE)

    await waitFor(() => expect(marks.filter((mark) => mark.visit === 2)).toHaveLength(1))
    expect(marks).toEqual([
      { through: 'cursor-001', visit: 1 },
      { through: 'cursor-000', visit: 2 },
    ])
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
})
