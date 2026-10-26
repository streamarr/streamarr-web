import type { ApolloCache, ApolloClient, ErrorLike } from '@apollo/client'
import { responsePathHasError } from '../graphql/responseErrors'
import {
  WatchStateChangedDocument,
  type WatchStateChangedSubscription,
} from '../graphql/generated/graphql'
import { applyWatchStateToLists, evictHiddenContinueWatching } from './watchStateLists'

type WatchStateChange = NonNullable<WatchStateChangedSubscription['watchStateChanged']>

/**
 * Applies the selected Profile's watch-state changes to the cache until the returned function
 * runs. Normalization carries each item's watched status and resume position to every cached
 * view of that item, and each shown list takes in, moves or drops the item by the server's
 * rules. A change whose fields failed applies only the items that resolved; the transport then
 * reports the change missed, and the active queries read again. A refusal or a normal end stops
 * the changes for good.
 */
export function subscribeToWatchStateChanges(client: ApolloClient): () => void {
  let stopped = false
  // The change is written here rather than by Apollo, which would write each failed field's null
  // over the value the cache holds.
  const subscription = client
    .subscribe({ query: WatchStateChangedDocument, fetchPolicy: 'no-cache', errorPolicy: 'all' })
    .subscribe(({ data, error }) => {
      const change = data?.watchStateChanged
      if (stopped || !change) return
      applyWatchStateChange(client.cache, change, error)
    })
  // A remount that subscribes before this task runs joins the same operation instead of ending
  // it and starting another.
  return () => {
    stopped = true
    setTimeout(() => subscription.unsubscribe())
  }
}

function applyWatchStateChange(
  cache: ApolloCache,
  change: WatchStateChange,
  error: ErrorLike | undefined,
): void {
  const items = change.items.filter(
    (item, index): item is NonNullable<typeof item> =>
      item !== null && !responsePathHasError(error, ['watchStateChanged', 'items', index]),
  )
  const continueWatching = (change.continueWatching ?? []).filter(
    (item, index): item is NonNullable<typeof item> =>
      item !== null &&
      !responsePathHasError(error, ['watchStateChanged', 'continueWatching', index]),
  )
  // Recovery reads only shown queries again, so a hidden shelf cannot wait for it.
  if (continueWatching.length !== change.continueWatching?.length) {
    evictHiddenContinueWatching(cache)
  }
  if (items.length === 0 && continueWatching.length === 0) return
  cache.writeQuery({
    query: WatchStateChangedDocument,
    id: 'ROOT_SUBSCRIPTION',
    data: { watchStateChanged: { ...change, items, continueWatching } },
  })
  applyWatchStateToLists(cache, continueWatching)
}
