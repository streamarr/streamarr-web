import type { ApolloClient } from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import { useRouteContext } from '@tanstack/react-router'
import { useEffect, useSyncExternalStore } from 'react'
import { UnreadPlaybackReportCountDocument } from '../../graphql/generated/graphql'
import { installRevalidation } from '../../graphql/revalidation'

interface UnreadCount {
  subscribe: (onChange: () => void) => () => void
  current: () => number | null
  isReading: () => boolean
  read: () => Promise<void>
}

const counts = new WeakMap<ApolloClient, UnreadCount>()

// Only the answer to the latest read counts: a read still out from before a report was marked read
// answers with the count from before, whenever it arrives.
function unreadCountFor(client: ApolloClient): UnreadCount {
  const existing = counts.get(client)
  if (existing) return existing
  let count: number | null = null
  let latestRead = 0
  let readsOut = 0
  const listeners = new Set<() => void>()
  const unread: UnreadCount = {
    subscribe: (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    current: () => count,
    isReading: () => readsOut > 0,
    read: async () => {
      const read = ++latestRead
      readsOut += 1
      try {
        const { data } = await client.query({
          query: UnreadPlaybackReportCountDocument,
          fetchPolicy: 'no-cache',
          context: { queryDeduplication: false },
        })
        if (read !== latestRead || !data) return
        count = data.unreadPlaybackReportCount
        for (const listener of listeners) listener()
      } catch {
        // A failed read leaves the count it last had.
      } finally {
        readsOut -= 1
      }
    },
  }
  counts.set(client, unread)
  return unread
}

/** How many shared playback reports no ServerAdmin has read; null until the server says. */
export function useUnreadReportCount(): number | null {
  const unread = unreadCountFor(useApolloClient())
  const { subscriptions } = useRouteContext({ from: '__root__' })
  // The count is no watched query, so it reads again by itself on each gap that the app's queries
  // read again on: the socket's missed changes, and the network's and the page's return.
  useEffect(() => {
    void unread.read()
    return installRevalidation({
      refetchActive: () => unread.read(),
      isReading: unread.isReading,
      onMissedChanges: (listener) => subscriptions.onMissedChanges(listener),
      window,
      document,
    })
  }, [unread, subscriptions])
  return useSyncExternalStore(unread.subscribe, unread.current)
}

/** Reads the unread count again, as after a report is marked read. */
export function readUnreadReportCountAgain(client: ApolloClient) {
  void unreadCountFor(client).read()
}
