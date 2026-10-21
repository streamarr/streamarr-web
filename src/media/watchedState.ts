import type { ApolloCache, NormalizedCacheObject } from '@apollo/client'
import type { MediaFilter, MediaSort } from '../graphql/generated/graphql'

export type LibraryItemsConnection = Readonly<{
  libraryId: string
  args: Readonly<{ first: number; sort: MediaSort; filter: MediaFilter }>
}>

const watchDependentConnectionsByCache = new WeakMap<
  ApolloCache,
  Map<string, LibraryItemsConnection>
>()

/**
 * Remembers a loaded `Library.items` connection when its membership or order follows watch
 * state, so `invalidateWatchedState` can evict it. Other connections are not remembered.
 */
export function trackLibraryItemsConnection(
  cache: ApolloCache,
  connection: LibraryItemsConnection,
) {
  const { sort, filter } = connection.args
  if (!filter.watchStatus && sort.by !== 'LAST_WATCHED') return
  const connections =
    watchDependentConnectionsByCache.get(cache) ?? new Map<string, LibraryItemsConnection>()
  watchDependentConnectionsByCache.set(cache, connections)
  connections.set(JSON.stringify(connection), connection)
}

/**
 * Evicts the collections whose membership or order can change with watch state: Continue
 * Watching and every remembered watch-dependent library connection. Cached items keep their
 * fields, because a mark payload updates them through normalization.
 */
export function invalidateWatchedState(cache: ApolloCache) {
  cache.evict({ fieldName: 'continueWatching' })
  evictWatchDependentConnections(cache, () => false)
}

/**
 * Evicts each remembered watch-dependent `Library.items` connection that `keep` rejects, and
 * forgets it, so the next read of that connection asks the server again.
 */
export function evictWatchDependentConnections(
  cache: ApolloCache,
  keep: (connection: LibraryItemsConnection) => boolean,
) {
  const connections = watchDependentConnectionsByCache.get(cache)
  for (const [key, connection] of connections ?? []) {
    if (keep(connection)) continue
    cache.evict({
      id: cache.identify({ __typename: 'Library', id: connection.libraryId }),
      fieldName: 'items',
      args: connection.args,
    })
    connections?.delete(key)
  }
}

export function discardWatchedState(cache: ApolloCache) {
  cache.evict({ fieldName: 'continueWatching' })
  // Boolean mutation results cannot update aggregates on cached parents or descendants.
  for (const id of Object.keys(cache.extract() as NormalizedCacheObject)) {
    cache.modify({
      id,
      fields: {
        watchStatus: (_value, { DELETE }) => DELETE,
        watchProgress: (_value, { DELETE }) => DELETE,
        // Membership and ordering can change even when the old connection was empty.
        items: (_value, { DELETE }) => DELETE,
      },
    })
  }
}
