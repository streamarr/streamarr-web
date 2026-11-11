import { useMutation } from '@apollo/client/react'
import { useEffect, useRef } from 'react'
import { MarkAllNotificationsReadDocument } from '../graphql/generated/graphql'

/**
 * Marks read what the page shows, once a visit: every Notification at or below `newestShown`, the
 * cursor of the newest row on screen, once the list has rendered. A Notification that arrives
 * later sits above it and stays unread until the next visit. A mark that fails waits for the next
 * visit too.
 */
export function useMarkShownRead(newestShown: string | null) {
  const [markAllRead] = useMutation(MarkAllNotificationsReadDocument)
  const marked = useRef(false)

  useEffect(() => {
    if (marked.current || newestShown === null) return
    marked.current = true
    void markAllRead({ variables: { input: { through: newestShown } } }).catch(() => undefined)
  }, [newestShown, markAllRead])
}
