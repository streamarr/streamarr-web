import { useApolloClient, useQuery } from '@apollo/client/react'
import { useCallback } from 'react'
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
 * last count, as does a read again that fails. Zero until the count is first read, and while it
 * cannot be: the count is a hint, never a failure of its own. `skip` reads nothing and follows
 * nothing. `receive` takes a count the server answered outside a change, such as a mark's.
 */
export function useUnreadNotificationCount({ skip }: { skip: boolean }): {
  count: number
  receive: (count: number) => void
} {
  const { cache } = useApolloClient()
  const live = useLiveList({
    query: UnreadNotificationCountDocument,
    variables: {},
    // Each change carries the whole count, so it replaces every count before it.
    keyOf: () => 'unreadNotificationCount',
    apply: (data, count: number) => ({ ...data, unreadNotificationCount: count }),
  })
  // Each count is whole, so one that arrives while the read has failed, or has not answered, stands
  // on its own rather than wait for a read that succeeds.
  const receive = useCallback(
    (count: number) => {
      if (skip) return
      live.receive(count)
      if (cache.readQuery({ query: UnreadNotificationCountDocument })) return
      cache.writeQuery({
        query: UnreadNotificationCountDocument,
        data: { unreadNotificationCount: count },
      })
    },
    [skip, live, cache],
  )
  useLiveChanges(
    NotificationsChangedDocument,
    ({ data }) => {
      const count = data?.notificationsChanged?.unreadNotificationCount
      if (typeof count === 'number') receive(count)
    },
    { skip },
  )
  const { data } = useQuery(UnreadNotificationCountDocument, { skip, context: live.context })
  return { count: data?.unreadNotificationCount ?? 0, receive }
}
