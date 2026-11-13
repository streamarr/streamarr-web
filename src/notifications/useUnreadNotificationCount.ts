import { useQuery } from '@apollo/client/react'
import {
  NotificationsChangedDocument,
  UnreadNotificationCountDocument,
} from '../graphql/generated/graphql'
import { useLiveList } from '../graphql/liveList'
import { useLiveChanges } from '../graphql/useLiveChanges'

/**
 * How many of the Account's Notifications are unread, as the server counts them, kept current by
 * each change to them on any page. A read on its way when a change arrives takes that change's
 * count again, since the change is newer (`useLiveList`). A change that could not count keeps the
 * last count, as does a read again that fails. Each change carries the whole count, so the menu
 * shows a change's count even when no read of the count has succeeded. Zero until a read or a
 * change first gives the count, and while neither can: the count is a hint, never a failure of its
 * own. `skip` reads nothing and follows nothing.
 */
export function useUnreadNotificationCount({ skip }: { skip: boolean }): number {
  const live = useLiveList({
    query: UnreadNotificationCountDocument,
    variables: {},
    // Each change carries the whole count, so it replaces every count before it.
    keyOf: () => 'unreadNotificationCount',
    apply: (data, count: number) => ({ ...data, unreadNotificationCount: count }),
    wholeAnswerFrom: (count) => ({ unreadNotificationCount: count }),
  })
  useLiveChanges(
    NotificationsChangedDocument,
    ({ data }) => {
      const count = data?.notificationsChanged?.unreadNotificationCount
      if (typeof count === 'number') live.receive(count)
    },
    { skip },
  )
  const { data } = useQuery(UnreadNotificationCountDocument, {
    skip,
    context: live.context,
    // Under cache-first, the menu leaves out a count that a change writes while a read is on its
    // way. When that read then fails, the menu still leaves the count out.
    fetchPolicy: 'cache-and-network',
  })
  return data?.unreadNotificationCount ?? 0
}
