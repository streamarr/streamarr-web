import type { DefaultContext } from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import { useEffect, useRef, useState } from 'react'
import {
  NotificationsDocument,
  type NotificationFieldsFragment,
  type NotificationsQuery,
} from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'
import { withOlderPage } from './notificationList'

/**
 * Loads the list's next older page after the end it has loaded, and adds it to the list. A load
 * already reading that page is not sent twice. A load that fails keeps its failure until the next
 * one starts. `context` is the list's own, so a page takes the changes that arrive on its way. The
 * loaded pages last as long as the page that shows them: the next visit reads the newest page
 * afresh. `onJoined` is handed the Notifications that each page adds to the list.
 */
export function useOlderNotifications(
  pageInfo: NotificationsQuery['notifications']['pageInfo'] | undefined,
  context: DefaultContext,
  onJoined: (notifications: NotificationFieldsFragment[]) => void,
) {
  const client = useApolloClient()
  const [failure, setFailure] = useState<unknown>(null)
  const reading = useRef<string | null>(null)
  const visit = useRef({ left: false })

  useEffect(() => {
    const current = { left: false }
    visit.current = current
    return () => {
      current.left = true
      client.cache.evict({ id: 'ROOT_QUERY', fieldName: 'notifications' })
      client.cache.gc()
    }
  }, [client])

  async function read(after: string) {
    const sentOn = visit.current
    const { data } = await client.query({
      query: NotificationsDocument,
      variables: { after },
      fetchPolicy: 'no-cache',
      // Apollo would otherwise join this read to an earlier visit's read of the same page that is
      // still on its way, and hand this visit that visit's answer.
      context: { ...context, queryDeduplication: false },
    })
    // A page that answers after the person left belongs to that visit, not to the next one.
    if (!data || sentOn.left) return
    const list = client.cache.readQuery({ query: NotificationsDocument })
    if (!list) return
    const notifications = withOlderPage(list.notifications, data.notifications, after)
    if (notifications === list.notifications) return
    client.cache.writeQuery({ query: NotificationsDocument, data: { ...list, notifications } })
    // The page joins after the list's own edges, without any the list already held.
    const joined = notifications.edges.slice(list.notifications.edges.length)
    onJoined(definedEdges(joined).map((edge) => edge.node))
  }

  function load() {
    const after = pageInfo?.hasNextPage ? pageInfo.endCursor : null
    if (!after || reading.current === after) return
    reading.current = after
    setFailure(null)
    void read(after)
      .catch(setFailure)
      .finally(() => {
        reading.current = null
      })
  }

  return { failure, load }
}
