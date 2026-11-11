import { placeOrderedEdge } from '../media/edges'
import type {
  OrderedEdgeFieldsFragment,
  ProfileShareChangedSubscription,
  ProfileShareStatus,
} from '../graphql/generated/graphql'

/** One committed change to a Profile share, as profileShareChanged delivers it. */
export type ShareChange = NonNullable<ProfileShareChangedSubscription['profileShareChanged']>
/** A share as a change carries it: every field that any list of shares reads. */
export type LiveShare = NonNullable<ShareChange['share']>

/** The key a change applies by: a share's later change replaces its earlier one. */
export function shareIdOf(change: ShareChange): string {
  return change.shareId
}

/** A profileShares list: one Profile's shares, in the statuses it asks for. */
export interface ProfileShareList {
  profileId: string
  /** The statuses the list asks for; every status when left out or empty. */
  statuses?: readonly ProfileShareStatus[]
}

/** A householdShares list: the shares into one Household, as the reader may list them. */
export interface HouseholdShareList {
  householdId: string
  /** The statuses the list asks for; every status when left out or empty. */
  statuses?: readonly ProfileShareStatus[]
  /** Whether the list asks only for visitors: Profiles that belong to another Household. */
  visitorsOnly?: boolean
  /** Whether the reader is a ServerAdmin, whose list holds a share at every status. */
  serverAdmin: boolean
}

/** Whether a profileShares list holds the share: while its status is one the list asks for. */
export function keepsInProfileShares(share: LiveShare, list: ProfileShareList, now: Date): boolean {
  return share.profileId === list.profileId && asksFor(list.statuses, listedStatus(share, now))
}

/**
 * Whether a householdShares list holds the share. A ServerAdmin's list holds it while its status
 * is one the list asks for. Anyone else's holds only offers still waiting for a decision and active
 * shares, whatever statuses it asks for. A list of visitors holds a share only while it is one.
 */
export function keepsInHouseholdShares(
  share: LiveShare,
  list: HouseholdShareList,
  now: Date,
): boolean {
  const status = listedStatus(share, now)
  if (share.householdId !== list.householdId || !asksFor(list.statuses, status)) return false
  if (list.visitorsOnly && share.visitor !== true) return false
  return list.serverAdmin || status === 'PENDING' || status === 'ACTIVE'
}

/**
 * Applies server-ordered changes within the loaded pages. The last loaded order key survives a
 * change removing that row; a new query or continuation supplies the next page boundary.
 */
export function createShareListUpdater() {
  let endCursor: string | null | undefined
  let lastOrderKey: string | null = null

  return function apply<TEdge extends OrderedEdgeFieldsFragment & { node: { id: string } }>(
    list: { edges: TEdge[]; pageInfo: { endCursor: string | null; hasNextPage: boolean } },
    change: { shareId: string; edge: TEdge | null },
  ): TEdge[] {
    if (list.pageInfo.endCursor !== endCursor) {
      endCursor = list.pageInfo.endCursor
      lastOrderKey = list.edges.find((edge) => edge.cursor === endCursor)?.orderKey ?? null
    }
    const beyondLoaded =
      change.edge !== null &&
      list.pageInfo.hasNextPage &&
      (lastOrderKey === null || change.edge.orderKey > lastOrderKey)
    return placeOrderedEdge(list.edges, {
      itemId: change.shareId,
      edge: beyondLoaded ? null : change.edge,
    })
  }
}

// The share queries count an offer past its expiry as EXPIRED before its change says so.
function listedStatus(share: LiveShare, now: Date): ProfileShareStatus {
  const expired =
    share.status === 'PENDING' &&
    share.expiresAt !== null &&
    Date.parse(share.expiresAt) <= now.getTime()
  return expired ? 'EXPIRED' : share.status
}

function asksFor(
  statuses: readonly ProfileShareStatus[] | undefined,
  status: ProfileShareStatus,
): boolean {
  return !statuses?.length || statuses.includes(status)
}
