import type { ApolloClient } from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import { useEffect, useSyncExternalStore } from 'react'
import { UnreadPlaybackReportCountDocument } from '../../graphql/generated/graphql'

interface UnreadCount {
  subscribe: (onChange: () => void) => () => void
  current: () => number | null
  read: () => void
}

const counts = new WeakMap<ApolloClient, UnreadCount>()

// Only the answer to the latest read counts: a read still out from before a report was marked read
// answers with the count from before, whenever it arrives.
function unreadCountFor(client: ApolloClient): UnreadCount {
  const existing = counts.get(client)
  if (existing) return existing
  let count: number | null = null
  let latestRead = 0
  const listeners = new Set<() => void>()
  const unread: UnreadCount = {
    subscribe: (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    current: () => count,
    read: () => {
      const read = ++latestRead
      client
        .query({
          query: UnreadPlaybackReportCountDocument,
          fetchPolicy: 'no-cache',
          context: { queryDeduplication: false },
        })
        .then(({ data }) => {
          if (read !== latestRead || !data) return
          count = data.unreadPlaybackReportCount
          for (const listener of listeners) listener()
        })
        // A failed read leaves the count it last had.
        .catch(() => undefined)
    },
  }
  counts.set(client, unread)
  return unread
}

/** How many shared playback reports no ServerAdmin has read; null until the server says. */
export function useUnreadReportCount(): number | null {
  const unread = unreadCountFor(useApolloClient())
  useEffect(() => unread.read(), [unread])
  return useSyncExternalStore(unread.subscribe, unread.current)
}

/** Reads the unread count again, as after a report is marked read. */
export function readUnreadReportCountAgain(client: ApolloClient) {
  unreadCountFor(client).read()
}
