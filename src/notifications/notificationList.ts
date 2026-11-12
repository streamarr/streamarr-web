import type { FieldPolicy, Reference } from '@apollo/client'
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
 * included, and never fewer than the newest page. A read again then answers for each row the
 * person may be looking at, so the list drops what the server no longer has, such as what
 * retention deleted, and shows how each request stands now.
 */
export function rowsToRead(list: NotificationList | undefined): number {
  return Math.min(Math.max(list?.edges.length ?? 0, NEWEST_PAGE), MOST_ROWS_IN_A_READ)
}

/** A list as the cache stores it, whatever its edges point to. */
interface StoredList<TEdge extends { orderKey: string }> {
  edges: readonly (TEdge | null)[]
  pageInfo: { hasNextPage: boolean; endCursor?: string | null }
}

/**
 * What the cache keeps when a list is written over the list it holds. A read from the start that
 * ends above the older pages the list has loaded, as when an older page joined while the read was
 * on its way, refreshes what it read and keeps the older pages after it, so the reader keeps
 * everything they have scrolled through. Any other write, such as a change applied to the list,
 * holds the whole list and takes its place.
 */
export function keepOlderPages<TEdge extends { orderKey: string }>(
  existing: StoredList<TEdge> | undefined,
  incoming: StoredList<TEdge>,
  idOf: (edge: TEdge) => unknown,
): StoredList<TEdge> {
  const last = incoming.edges.findLast((edge) => edge !== null)
  if (!existing || !last || !incoming.pageInfo.hasNextPage) return incoming
  if (existing.pageInfo.endCursor === incoming.pageInfo.endCursor) return incoming
  const held = new Set(incoming.edges.map((edge) => edge && idOf(edge)))
  const older = existing.edges.filter(
    (edge) => edge !== null && edge.orderKey > last.orderKey && !held.has(idOf(edge)),
  )
  if (older.length === 0) return incoming
  return { ...incoming, edges: [...incoming.edges, ...older], pageInfo: existing.pageInfo }
}

type StoredEdge = { orderKey: string; node: Reference | null }

/** The Account's one list of Notifications in the cache, however many pages it has loaded. */
export const notificationsField: FieldPolicy<StoredList<StoredEdge>> = {
  keyArgs: false,
  merge: (existing, incoming, { readField }) =>
    keepOlderPages(existing, incoming, (edge) => edge.node && readField('id', edge.node)),
}
