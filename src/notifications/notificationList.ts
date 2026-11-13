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

/** One Notification that a change touched: its edge in the list, or null once it left the list. */
export interface NotificationEntry {
  notificationId: string
  edge: ShownEdge | null
}

/** The pages of the Account's list of Notifications that one visit loads, as changes reach them. */
export function createLoadedPages() {
  // The order key of the row at each end cursor that the visit has held. The next page starts after
  // that row's place, also once a change has moved the row up or taken it out.
  const endKeys = new Map<string, string>()

  function endOf(list: NotificationList) {
    const last = definedEdges(list.edges).at(-1)?.orderKey
    const { endCursor } = list.pageInfo
    if (!endCursor) return last
    const atEnd = list.edges.find((stored) => stored?.cursor === endCursor)
    if (atEnd) endKeys.set(endCursor, atEnd.orderKey)
    return endKeys.get(endCursor) ?? last
  }

  return {
    /**
     * The list once one Notification's change applies, by its id: its edge takes its place by
     * order key, and a null edge takes it out. While older pages are still to load, an edge that
     * sorts below the loaded pages belongs to one of them, so the list lets the Notification go
     * and that page brings it. The loaded pages end where the next page starts, at the place of
     * the row their end cursor names.
     */
    withChange(
      list: NotificationList,
      { notificationId, edge }: NotificationEntry,
    ): NotificationList {
      const edges = definedEdges(list.edges)
      const end = endOf(list)
      const below =
        edge !== null && list.pageInfo.hasNextPage && end !== undefined && edge.orderKey > end
      return {
        ...list,
        edges: placeOrderedEdge(edges, { itemId: notificationId, edge: below ? null : edge }),
      }
    },
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

/** A list as the cache stores it, whatever its edges point to. */
interface StoredList<TEdge extends { orderKey: string }> {
  edges: readonly (TEdge | null)[]
  pageInfo: { hasNextPage: boolean; endCursor?: string | null }
}

/**
 * What the cache keeps when a list is written over the list it holds. A read of the newest page
 * that ends above the older pages the list has loaded refreshes the newest page and keeps the
 * older ones after it, so a list read again keeps everything the reader has scrolled through. Any
 * other write, such as a change applied to the list, holds the whole list and takes its place.
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
