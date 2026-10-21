import type { ApolloCache } from '@apollo/client'
import {
  HomeDocument,
  type ContinueWatchingEdgeFieldsFragment,
  type WatchStateChangedSubscription,
} from '../graphql/generated/graphql'
import { definedEdges, placeOrderedEdge } from './edges'
import { evictWatchDependentConnections } from './watchedState'

type ContinueWatchingChange = NonNullable<
  NonNullable<
    NonNullable<WatchStateChangedSubscription['watchStateChanged']>['continueWatching']
  >[number]
>
type ShelfEdge = ContinueWatchingEdgeFieldsFragment & {
  node: NonNullable<ContinueWatchingEdgeFieldsFragment['node']>
}
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

/** Drops Home's cached Continue Watching unless a caller shows it, so Home reads it again. */
export function evictHiddenContinueWatching(cache: ApolloCache) {
  if (liveListsFor(cache).continueWatching > 0) return
  cache.evict({ fieldName: 'continueWatching' })
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
    let edges: ShelfEdge[] = []
    for (const edge of definedEdges(data.continueWatching.edges)) {
      edges = placeOrderedEdge(edges, { itemId: edge.node.id, edge })
    }
    for (const { itemId, edge } of changes) {
      if (edge === null) edges = placeOrderedEdge(edges, { itemId, edge })
      if (edge?.node)
        edges = placeOrderedEdge(edges, { itemId, edge: { ...edge, node: edge.node } })
    }
    return {
      ...data,
      continueWatching: {
        ...data.continueWatching,
        edges: edges.slice(0, CONTINUE_WATCHING_LIMIT),
      },
    }
  })
}
