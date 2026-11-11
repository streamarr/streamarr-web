import { waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type {
  NotificationEdgeFieldsFragment,
  NotificationsChangedSubscription,
  NotificationsQuery,
} from '../graphql/generated/graphql'
import type { serveGraphqlSocket } from './graphqlSocket'

type Node = NonNullable<NotificationEdgeFieldsFragment['node']>
type OfferNode = Extract<Node, { __typename: 'ProfileShareOfferedNotification' }>
type NewsNode = Exclude<Node, OfferNode>

/** A Notification of an offer, as the server answers it, with the share it is about. */
export type OfferNotificationFixture = Omit<OfferNode, 'share'> & {
  share: OfferNode['share'] & { __typename: 'ProfileShare' }
}

export type NotificationFixture = OfferNotificationFixture | NewsNode

const HOUR = 60 * 60 * 1000

/** A moment `hours` before now, as the server writes one. */
export function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString()
}

/** An offer of Alex to the reader's Household that waits for a decision, unread. */
export function offerNotification(
  overrides: Partial<OfferNotificationFixture> = {},
): OfferNotificationFixture {
  return {
    __typename: 'ProfileShareOfferedNotification',
    id: 'offer-of-alex',
    message: '“Sam” offered the Profile “Alex” to your Household.',
    latestEventAt: hoursAgo(1),
    unread: true,
    expiresAt: new Date(Date.now() + 7 * 24 * HOUR).toISOString(),
    resolution: null,
    share: { __typename: 'ProfileShare', id: 'share-of-alex', status: 'PENDING' },
    ...overrides,
  }
}

/** News that Cabin accepted the offer of Leo, read. */
export function answerNotification(overrides: Partial<NewsNode> = {}): NewsNode {
  return {
    __typename: 'ProfileShareAnsweredNotification',
    id: 'answer-for-leo',
    message: '“Cabin” accepted the Profile “Leo”.',
    latestEventAt: hoursAgo(2),
    unread: false,
    ...overrides,
  }
}

type Edge = NotificationsQuery['notifications']['edges'][number]

/**
 * The edge of `node` at position `at` of the list: its cursor and order key follow the position,
 * so that a list built from edges at rising positions is newest first.
 */
export function notificationEdge(node: NotificationFixture | null, at: number): Edge {
  const position = String(at).padStart(3, '0')
  return {
    __typename: 'NotificationEdge',
    cursor: `cursor-${position}`,
    orderKey: `key-${position}`,
    node,
  } as Edge
}

/** A page of the list: `nodes` from position `from`, newest first. */
export function notificationsPage(
  nodes: (NotificationFixture | null)[],
  { from = 1, hasNextPage = false }: { from?: number; hasNextPage?: boolean } = {},
): NotificationsQuery {
  const edges = nodes.map((node, index) => notificationEdge(node, from + index))
  return {
    notifications: {
      __typename: 'NotificationConnection',
      edges,
      pageInfo: {
        __typename: 'PageInfo',
        hasNextPage,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
    },
  } as NotificationsQuery
}

type Entry = NotificationsChangedSubscription['notificationsChanged'] extends infer Change
  ? Change extends { notifications: (infer E)[] }
    ? E
    : never
  : never

/** A change that touched each of `entries`, with the Account's unread count after it. */
export function notificationsChanged(
  entries: Entry[],
  unreadNotificationCount: number | null = null,
) {
  return {
    data: {
      notificationsChanged: {
        __typename: 'NotificationsChange',
        notifications: entries,
        unreadNotificationCount,
      },
    },
  }
}

/** The entry of a change for the Notification at `edge`, or for one that left the list. */
export function notificationChange(notificationId: string, edge: Edge | null): Entry {
  return { __typename: 'NotificationChange', notificationId, edge } as Entry
}

/**
 * Waits until the session follows changes to the Account's Notifications, as the Profile menu's
 * count does on every page of an account session, so that a change published next reaches it.
 */
export async function followingNotificationChanges(socket: ReturnType<typeof serveGraphqlSocket>) {
  await waitFor(() => expect(socket.isLive('NotificationsChanged')).toBe(true))
}
