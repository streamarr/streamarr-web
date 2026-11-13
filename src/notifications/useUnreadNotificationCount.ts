import { useQuery } from '@apollo/client/react'
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
 * last count, as does a read again that fails. Each change carries the whole count, so the menu
 * shows a change's count even when no read of the count has succeeded. Zero until a read or a
 * change first gives the count, and while neither can: the count is a hint, never a failure of its
 * own. `skip` reads nothing and follows nothing.
 *
 * `markSent` is called as a mark goes out, and the function it returns takes the count the mark
 * answers. A change that arrives in between means the server is delivering changes, this mark's
 * own among them, and it may be newer than the mark, such as another session's mark; the mark's
 * count then stands aside. A mark's count also stands aside once the count of a mark that went out
 * after it has been taken. A visit of a page sends its marks one after another, but a mark from an
 * earlier visit can answer after a mark from the next visit.
 *
 * When a read of the count and a mark overlap, nothing tells which count is newer. A mark that
 * answers after the read replaces the read's count, even a newer one, until the next mark, change
 * or read again. ADR 0042 accepts such a late answer.
 */
export function useUnreadNotificationCount({ skip }: { skip: boolean }): {
  count: number
  markSent: () => (count: number) => void
} {
  const changes = useRef(0)
  // Each mark is numbered as it goes out; `taken` is the newest mark whose count was taken.
  const marks = useRef({ sent: 0, taken: 0 })
  const live = useLiveList({
    query: UnreadNotificationCountDocument,
    variables: {},
    // Each change carries the whole count, so it replaces every count before it.
    keyOf: () => 'unreadNotificationCount',
    apply: (data, count: number) => ({ ...data, unreadNotificationCount: count }),
    wholeAnswerFrom: (count) => ({ unreadNotificationCount: count }),
  })
  const receive = useCallback(
    (count: number) => {
      if (skip) return
      live.receive(count)
    },
    [skip, live],
  )
  const markSent = useCallback(() => {
    const changesBefore = changes.current
    marks.current.sent += 1
    const mark = marks.current.sent
    return (count: number) => {
      if (changes.current !== changesBefore || mark < marks.current.taken) return
      marks.current.taken = mark
      receive(count)
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
  const { data } = useQuery(UnreadNotificationCountDocument, {
    skip,
    context: live.context,
    // Under cache-first, the menu leaves out a count that a change writes while a read is on its
    // way. When that read then fails, the menu still leaves the count out.
    fetchPolicy: 'cache-and-network',
  })
  return { count: data?.unreadNotificationCount ?? 0, markSent }
}
