import type { ErrorLike } from '@apollo/client'
import {
  NotificationsChangedDocument,
  type NotificationsChangedSubscription,
} from '../graphql/generated/graphql'
import { responsePathHasError } from '../graphql/responseErrors'
import { useLiveChanges } from '../graphql/useLiveChanges'
import type { NotificationEntry } from './notificationList'

type Entry = NonNullable<
  NonNullable<NotificationsChangedSubscription['notificationsChanged']>['notifications'][number]
>

/**
 * Hands the Notifications that each committed change touched to `onEntries` while the calling
 * component is mounted, each with the edge the list shows it by, or with none when it was
 * dismissed. A page calls it before it queries the list, so the list misses no change
 * (`useLiveChanges`).
 *
 * An entry that came with an error keeps the Notification as it was: a null edge there is no
 * dismissal, and the transport reports the change missed, so the list reads again. So does an edge
 * whose Notification failed to resolve.
 */
export function useNotificationChanges(onEntries: (entries: NotificationEntry[]) => void) {
  useLiveChanges(NotificationsChangedDocument, ({ data, error }) => {
    const change = data?.notificationsChanged
    if (!change) return
    const entries = change.notifications.flatMap((entry, index) =>
      entry ? applicable(entry, index, error) : [],
    )
    if (entries.length > 0) onEntries(entries)
  })
}

function applicable(
  entry: Entry,
  index: number,
  error: ErrorLike | undefined,
): NotificationEntry[] {
  if (responsePathHasError(error, ['notificationsChanged', 'notifications', index])) return []
  const { notificationId, edge } = entry
  if (edge === null) return [{ notificationId, edge: null }]
  if (edge.node === null) return []
  return [{ notificationId, edge: { ...edge, node: edge.node } }]
}
