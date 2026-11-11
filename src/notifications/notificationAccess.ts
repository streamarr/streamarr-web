import type { MeQuery } from '../graphql/generated/graphql'

/**
 * Whether the session may read the Account's Notifications: any account session, and never a
 * session bound to a TV. This controls presentation only; the server rechecks each operation.
 */
export function canReadNotifications(
  me: Pick<MeQuery['me'], 'deviceBound'> | null | undefined,
): boolean {
  return me?.deviceBound === false
}
