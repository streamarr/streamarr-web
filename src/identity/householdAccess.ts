import type { MeQuery } from '../graphql/generated/graphql'

/**
 * Whether the current account session may open its Household's settings: a HouseholdAdmin, and
 * never a session bound to a TV. This controls presentation only; the server rechecks each
 * operation.
 */
export function canManageHousehold(
  me: Pick<MeQuery['me'], 'householdRole' | 'deviceBound'> | null | undefined,
): boolean {
  return me?.householdRole === 'ADMIN' && me.deviceBound === false
}
