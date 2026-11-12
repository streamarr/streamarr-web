import { useApolloClient, useQuery } from '@apollo/client/react'
import { useCallback, useRef } from 'react'
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
 * nothing.
 *
 * `markSent` is called as a mark goes out, and the function it returns takes the count the mark
 * answers. A change that arrives in between means the server is delivering changes, this mark's
 * own among them, and it may be newer than the mark, such as another session's mark; the mark's
 * count then stands aside.
 */
export function useUnreadNotificationCount({ skip }: { skip: boolean }): {
  count: number
  markSent: () => (count: number) => void
} {
  const { cache } = useApolloClient()
  const changes = useRef(0)
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
  const markSent = useCallback(() => {
    const changesBefore = changes.current
    return (count: number) => {
      if (changes.current === changesBefore) receive(count)
    }
  }, [receive])
  useLiveChanges(
    NotificationsChangedDocument,
    ({ data }) => {
      const count = data?.notificationsChanged?.unreadNotificationCount
      if (typeof count !== 'number') return
      changes.current += 1
      receive(count)
    },
    { skip },
  )
  const { data } = useQuery(UnreadNotificationCountDocument, { skip, context: live.context })
  return { count: data?.unreadNotificationCount ?? 0, markSent }
}
