import { expect, test } from '@playwright/test'
import { routeGraphqlSocket } from './graphqlSocket'
import { serveSharingPages } from './sharingPages'

// The page's GraphQL requests must reach page.route, which a service worker would answer first.
test.use({ serviceWorkers: 'block' })

const HOUR = 60 * 60 * 1000

function news(id: string, message: string, at: number) {
  const position = String(at).padStart(3, '0')
  return {
    __typename: 'NotificationEdge',
    cursor: `cursor-${position}`,
    orderKey: `key-${position}`,
    node: {
      __typename: 'ProfileShareAnsweredNotification',
      id,
      message,
      latestEventAt: new Date(Date.now() - at * HOUR).toISOString(),
      unread: true,
    },
  }
}

const UNREAD = [
  news('answer-for-leo', '“Cabin” accepted the Profile “Leo”.', 1),
  news('answer-for-mara', '“Lake House” accepted the Profile “Mara”.', 2),
]

test('the unread count and the dot clear once the Notifications page has been opened', async ({
  page,
  request,
}) => {
  const server = { unread: 2 }
  const socket = await routeGraphqlSocket(page)
  await serveSharingPages(page, request, {
    UnreadNotificationCount: () => ({ unreadNotificationCount: server.unread }),
    Notifications: {
      notifications: {
        __typename: 'NotificationConnection',
        edges: UNREAD,
        pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: 'cursor-002' },
      },
    },
    MarkAllNotificationsRead: () => {
      server.unread = 0
      return {
        markAllNotificationsRead: {
          __typename: 'MarkAllNotificationsReadPayload',
          unreadNotificationCount: 0,
          userErrors: [],
        },
      }
    },
  })
  await page.goto('/')

  const marked = page.getByRole('button', { name: 'Profile menu (Alex), has notifications' })
  await expect(marked.getByTestId('unread-dot')).toBeVisible()
  await marked.click()
  const entry = page.getByRole('button', { name: 'Notifications, 2 unread' })
  await expect(entry).toHaveText('Notifications2')
  const markedRead = page.waitForRequest(
    (sent) =>
      (sent.postDataJSON() as { operationName?: string } | null)?.operationName ===
      'MarkAllNotificationsRead',
  )
  await entry.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
  await markedRead
  // The server tells every session of the Account its count after the mark.
  await expect.poll(() => socket.isLive('NotificationsChanged')).toBe(true)
  socket.publish('NotificationsChanged', {
    data: {
      notificationsChanged: {
        __typename: 'NotificationsChange',
        notifications: [],
        unreadNotificationCount: 0,
      },
    },
  })

  const chip = page.getByRole('button', { name: 'Profile menu (Alex)', exact: true })
  await expect(chip).toBeVisible()
  await expect(chip.getByTestId('unread-dot')).toHaveCount(0)
  await chip.click()
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toHaveText(
    'Notifications',
  )
})
