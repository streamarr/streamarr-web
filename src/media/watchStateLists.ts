import type { ApolloCache } from '@apollo/client'
import {
  HomeDocument,
  type ContinueWatchingEdgeFieldsFragment,
  type WatchStateChangedSubscription,
} from '../graphql/generated/graphql'
import { evictWatchDependentConnections } from './watchedState'

type ContinueWatchingChange = NonNullable<
  NonNullable<WatchStateChangedSubscription['watchStateChanged']>['continueWatching'][number]
>
interface LiveLists {
  continueWatching: number
}

/** How many Continue Watching entries Home reads. */
export const CONTINUE_WATCHING_LIMIT = 12
const liveListsByCache = new WeakMap<ApolloCache, LiveLists>()

function liveListsFor(cache: ApolloCache): LiveLists {
  let lists = liveListsByCache.get(cache)
  if (!lists) {
    lists = { continueWatching: 0 }
    liveListsByCache.set(cache, lists)
  }
  return lists
}

/** Keeps Home's Continue Watching current while the caller shows it. Returns the release. */
export function showContinueWatching(cache: ApolloCache): () => void {
  const lists = liveListsFor(cache)
  lists.continueWatching += 1
  return () => {
    lists.continueWatching -= 1
  }
}

/** Updates Continue Watching; library content subscriptions own library membership. */
export function applyWatchStateToLists(
  cache: ApolloCache,
  changes: readonly ContinueWatchingChange[],
) {
  applyToContinueWatching(cache, liveListsFor(cache), changes)
  evictWatchDependentConnections(cache)
}

function applyToContinueWatching(
  cache: ApolloCache,
  lists: LiveLists,
  changes: readonly ContinueWatchingChange[],
) {
  if (changes.length === 0) return
  if (lists.continueWatching === 0) {
    cache.evict({ fieldName: 'continueWatching' })
    return
  }
  const variables = { continueWatchingFirst: CONTINUE_WATCHING_LIMIT }
  cache.updateQuery({ query: HomeDocument, variables }, (data) => {
    if (!data) return undefined
    const entries = new Map<string, ContinueWatchingEdgeFieldsFragment>()
    for (const edge of data.continueWatching.edges) {
      if (edge?.node) entries.set(edge.node.id, edge)
    }
    for (const change of changes) {
      if (change.edge === null) entries.delete(change.itemId)
      if (change.edge?.node) entries.set(change.itemId, change.edge)
    }
    const edges = [...entries.values()]
      .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0))
      .slice(0, CONTINUE_WATCHING_LIMIT)
    return { ...data, continueWatching: { ...data.continueWatching, edges } }
  })

}
