import type {
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
 * A list's edges once a change applies, by the change's shareId. A share that the list keeps takes
 * the place of the one it held, or goes first, since the lists put the newest share first. Any
 * other share leaves, as does one that no longer exists. A change that concerns none of the
 * list's shares and that the list does not keep leaves the edges as they were.
 */
export function withShareChange<TNode extends { id: string }>(
  edges: { node: TNode }[],
  change: { shareId: string; share: (LiveShare & TNode) | null },
  keeps: (share: LiveShare) => boolean,
): { node: TNode }[] {
  const kept = change.share && keeps(change.share) ? change.share : null
  const index = edges.findIndex((edge) => edge.node.id === change.shareId)
  if (index === -1) return kept ? [{ node: kept }, ...edges] : edges
  const others = edges.filter((_, at) => at !== index)
  if (!kept) return others
  return others.toSpliced(index, 0, { ...edges[index], node: kept })
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
