import { expect, test, type Page } from '@playwright/test'
import { routeGraphqlSocket } from './graphqlSocket'
import { serveSharingPages } from './sharingPages'

// The page's GraphQL requests must reach page.route, which a service worker would answer first.
test.use({ serviceWorkers: 'block' })

const HOUR = 60 * 60 * 1000

function news(id: string, message: string, at: number, unread = true) {
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
      unread,
    },
  }
}

/** The colour a design token resolves to in the page, as computed styles report it. */
function tokenColour(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  }, token)
}

const UNREAD = [
  news('answer-for-leo', '“Cabin” accepted the Profile “Leo”.', 1),
  news('answer-for-mara', '“Lake House” accepted the Profile “Mara”.', 2),
]

test('the unread count and the dot clear once the Notifications page has been opened', async ({
  page,
  request,
}) => {
  const server = { unread: 2, marked: [] as string[] }
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
    MarkNotificationRead: (variables) => {
      server.marked.push((variables.input as { notificationId: string }).notificationId)
      server.unread -= 1
      return {
        markNotificationRead: {
          __typename: 'MarkNotificationReadPayload',
          unreadNotificationCount: server.unread,
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
  await entry.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
  await expect.poll(() => server.marked).toEqual(['answer-for-leo', 'answer-for-mara'])
  // The server tells every session of the Account about each Notification that a mark changed.
  await expect.poll(() => socket.isLive('NotificationsChanged')).toBe(true)
  socket.publish('NotificationsChanged', {
    data: {
      notificationsChanged: {
        __typename: 'NotificationsChange',
        notifications: UNREAD.map((edge, index) => ({
          __typename: 'NotificationChange',
          notificationId: edge.node.id,
          edge: news(edge.node.id, edge.node.message, index + 1, false),
        })),
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

// The dot and the row's mark are marks, which need 3:1 against what they sit on; the brief gives
// them indicator.activeTrack until the dot has a token of its own.
test('the avatar dot and each unread row mark take the indicator colour', async ({
  page,
  request,
}) => {
  await serveSharingPages(page, request, {
    UnreadNotificationCount: { unreadNotificationCount: 2 },
    Notifications: {
      notifications: {
        __typename: 'NotificationConnection',
        edges: UNREAD,
        pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: 'cursor-002' },
      },
    },
  })
  await page.goto('/')
  const indicator = await tokenColour(page, '--indicator-active-track')

  const chip = page.getByRole('button', { name: 'Profile menu (Alex), has notifications' })
  await expect(chip.getByTestId('unread-dot')).toHaveCSS('background-color', indicator)
  await page.goto('/notifications')
  const rows = page.getByRole('list', { name: 'Notifications' }).getByRole('listitem')
  await expect(rows.first().getByTestId('unread-mark')).toHaveCSS('background-color', indicator)
})

// A count is text, so it takes text.primary, which reaches 4.5:1 against the menu, and it draws
// no badge around itself.
test('a count after a menu entry is a plain number in the primary text colour', async ({
  page,
  request,
}) => {
  await serveSharingPages(page, request, {
    UnreadNotificationCount: { unreadNotificationCount: 3 },
  })
  await page.goto('/')
  const primary = await tokenColour(page, '--text-primary')

  await page.getByRole('button', { name: 'Profile menu (Alex), has notifications' }).click()
  const count = page.getByRole('button', { name: 'Notifications, 3 unread' }).getByText('3')

  await expect(count).toHaveCSS('color', primary)
  await expect(count).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(count).toHaveCSS('border-radius', '0px')
})
