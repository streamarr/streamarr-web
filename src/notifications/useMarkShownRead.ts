import { useMutation } from '@apollo/client/react'
import { useCallback, useEffect, useRef } from 'react'
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
 * a visit, one after another, so that each answer's unread count, handed to `onCount`, is newer
 * than the one before it. A mark that fails waits for the next visit.
 */
export function useMarkShownRead(
  newestPage: readonly Shown[] | null,
  onCount: (count: number) => void,
) {
  const [markOne] = useMutation(MarkNotificationReadDocument)
  const sent = useRef(new Set<string>())
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const markedNewest = useRef(false)

  const markRead = useCallback(
    (notifications: readonly Shown[]) => {
      for (const { id, unread } of notifications) {
        if (!unread || sent.current.has(id)) continue
        sent.current.add(id)
        queue.current = queue.current.then(() =>
          markOne({ variables: { input: { notificationId: id } } })
            .then(({ data }) => {
              const count = data?.markNotificationRead?.unreadNotificationCount
              if (typeof count === 'number') onCount(count)
            })
            .catch(() => undefined),
        )
      }
    },
    [markOne, onCount],
  )

  useEffect(() => {
    if (markedNewest.current || newestPage === null) return
    markedNewest.current = true
    markRead(newestPage)
  }, [newestPage, markRead])

  return markRead
}
