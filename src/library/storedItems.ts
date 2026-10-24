import type { ApolloCache, InMemoryCache, Reference, StoreObject } from '@apollo/client'
import type { LibraryPageQuery, MediaFilter, MediaSort } from '../graphql/generated/graphql'

type Items = LibraryPageQuery['library']['items']
// Stored edges are embedded objects whose nodes are references to normalized items.
export type StoredEdge = {
  __typename: 'MediaEdge'
  cursor: string
  orderKey: string
  node: Reference | null
}
export type StoredItems = Omit<Items, 'edges'> & { edges: (StoredEdge | null)[] }

/** Rewrites the stored titles of one library view, leaving every other sort and filter alone. */
export function modifyLoadedItems(
  cache: ApolloCache,
  {
    libraryId,
    sort,
    filter,
  }: { libraryId: string; sort?: MediaSort | null; filter?: MediaFilter | null },
  update: (
    items: StoredItems,
    toReference: (item: StoreObject) => Reference | undefined,
  ) => StoredItems,
) {
  // cache.modify cannot target one argument variant of a field (apollo-client#7129).
  const itemsField = (cache as InMemoryCache).policies.getStoreFieldName({
    typename: 'Library',
    fieldName: 'items',
    args: { sort, filter },
  })
  cache.modify<{ items: StoredItems }>({
    id: cache.identify({ __typename: 'Library', id: libraryId }),
    fields: {
      items(stored, { storeFieldName, isReference, toReference }) {
        if (storeFieldName !== itemsField || isReference(stored)) return stored
        return update(stored, toReference)
      },
    },
  })
}
