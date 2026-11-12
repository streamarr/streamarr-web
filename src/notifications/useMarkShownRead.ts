import { useMutation } from '@apollo/client/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MarkNotificationReadDocument } from '../graphql/generated/graphql'

/** A Notification as the page shows it, by its id. */
interface Shown {
  id: string
  unread: boolean
}

/**
 * Marks read, by their ids, the unread Notifications that a read of the list brought to the page:
 * `newestPage` once it has rendered, and each older page that the returned function is handed as
 * it joins the list. A Notification that reaches the page any other way, such as one that commits
 * late and sorts below the rows shown, stays unread until a visit reads it. Each id is marked once
 * a visit, one after another, so that each answer's unread count is newer than the one before it.
 * `markSent` is called as each mark goes out, and its function takes the count the mark answers
 * (`useUnreadNotificationCount`). A mark that fails waits for the next visit.
 *
 * `marked` holds the ids it marked this visit. The server tells every socket, this page's too,
 * that each of them is read, so the page draws them as unread from `marked` until the next visit.
 */
export function useMarkShownRead(
  newestPage: readonly Shown[] | null,
  markSent: () => (count: number) => void,
) {
  const [markOne] = useMutation(MarkNotificationReadDocument)
  const sent = useRef(new Set<string>())
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const markedNewest = useRef(false)
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set())

  const markRead = useCallback(
    (notifications: readonly Shown[]) => {
      const fresh = notifications.filter(({ id, unread }) => unread && !sent.current.has(id))
      if (fresh.length === 0) return
      setMarked((before) => new Set([...before, ...fresh.map(({ id }) => id)]))
      for (const { id } of fresh) {
        sent.current.add(id)
        queue.current = queue.current.then(() => {
          const answered = markSent()
          return markOne({ variables: { input: { notificationId: id } } })
            .then(({ data }) => {
              const count = data?.markNotificationRead?.unreadNotificationCount
              if (typeof count === 'number') answered(count)
            })
            .catch(() => undefined)
        })
      }
    },
    [markOne, markSent],
  )

  useEffect(() => {
    if (markedNewest.current || newestPage === null) return
    markedNewest.current = true
    markRead(newestPage)
  }, [newestPage, markRead])

  return { marked, markRead }
}
