import type { MeQuery } from '../graphql/generated/graphql'

/**
 * Whether the current account session may enter server administration. Profile and household
 * roles never grant this capability. This controls presentation only: each server operation
 * rechecks live account authority, including whether the account is still enabled.
 */
export function canManageServer(
  me: Pick<MeQuery['me'], 'serverAdmin' | 'deviceBound'> | null | undefined,
): boolean {
  return me?.serverAdmin === true && me.deviceBound === false
}
