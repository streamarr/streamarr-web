import type { FieldPolicy } from '@apollo/client'
import type {
  NotificationEdgeFieldsFragment,
  NotificationsQuery,
} from '../graphql/generated/graphql'
import { definedEdges, placeOrderedEdge } from '../media/edges'

type NotificationList = NotificationsQuery['notifications']

/** An edge whose Notification resolved, as the list shows it. */
type ShownEdge = NotificationEdgeFieldsFragment & {
  node: NonNullable<NotificationEdgeFieldsFragment['node']>
}

/** One Notification that a change touched: its edge in the list, or null once it is dismissed. */
export interface NotificationEntry {
  notificationId: string
  edge: ShownEdge | null
}

/**
 * The list once one Notification's change applies, by its id: its edge takes its place by order
 * key, and a null edge takes it out. While older pages are still to load, an edge that sorts below
 * the loaded list belongs to one of them, so the list lets the Notification go and that page
 * brings it.
 */
export function withNotificationChange(
  list: NotificationList,
  { notificationId, edge }: NotificationEntry,
): NotificationList {
  const edges = definedEdges(list.edges)
  const last = edges.at(-1)
  const below =
    edge !== null && list.pageInfo.hasNextPage && !!last && edge.orderKey > last.orderKey
  return {
    ...list,
    edges: placeOrderedEdge(edges, { itemId: notificationId, edge: below ? null : edge }),
  }
}

/**
 * The list once an older page joins it: the page's edges after the list's own, without a
 * Notification the list already holds, since one that moved can arrive twice. A page read after
 * another cursor than the list's end belongs to a list that was read again since, and joins
 * nothing.
 */
export function withOlderPage(
  list: NotificationList,
  page: NotificationList,
  after: string,
): NotificationList {
  if (list.pageInfo.endCursor !== after) return list
  const held = new Set(list.edges.map((edge) => edge?.node?.id))
  const older = page.edges.filter((edge) => !edge?.node || !held.has(edge.node.id))
  return { ...list, edges: [...list.edges, ...older], pageInfo: page.pageInfo }
}

/** The rows of the newest page: the server's own page size. */
const NEWEST_PAGE = 20

/** The most rows the server reads in one page. */
const MOST_ROWS_IN_A_READ = 500

/**
 * How many rows a read of the list from its start asks for: every row the list holds, older pages
 * included, never fewer than the newest page and never more than the server reads at once. The
 * answer takes the place of the whole list, so the list drops what the server no longer has, such
 * as what retention deleted, and shows how each request stands now. A row past the answer's end,
 * such as a row that news pushed down or a row past the 500th, loads again as the end of the list
 * comes into view.
 */
export function rowsToRead(list: NotificationList | undefined): number {
  return Math.min(Math.max(list?.edges.length ?? 0, NEWEST_PAGE), MOST_ROWS_IN_A_READ)
}

/**
 * The Account's one list of Notifications in the cache, however many pages it has loaded. Each
 * write holds a whole list and takes the place of the list that the cache holds.
 */
export const notificationsField: FieldPolicy = { keyArgs: false, merge: false }
