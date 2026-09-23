import type { ApolloCache, NormalizedCacheObject } from '@apollo/client'

export function invalidateWatchedState(cache: ApolloCache) {
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
