import type { ApolloCache, InMemoryCache, Reference, StoreObject } from '@apollo/client'
import {
  MediaSummaryFieldsFragmentDoc,
  type LibraryPageQuery,
  type MediaSummaryFieldsFragment,
  type MediaFilter,
  type MediaSort,
} from '../graphql/generated/graphql'

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

/** Normalizes a page's titles and returns its edges as stored, each pointing at its title. */
export function storeEdges(cache: ApolloCache, edges: Items['edges']): StoredItems['edges'] {
  return (edges ?? []).map((edge) => {
    if (!edge) return null
    const node = edge.node ? (writeTitle(cache, edge.node) ?? null) : null
    return { __typename: 'MediaEdge', cursor: edge.cursor, orderKey: edge.orderKey, node }
  })
}

/**
 * Normalizes one title. Apollo retains every entity written explicitly, against gc; a title is
 * released at once, so it stays only while a list or query still reaches it.
 */
export function writeTitle(cache: ApolloCache, title: MediaSummaryFieldsFragment) {
  const reference = cache.writeFragment({
    fragment: MediaSummaryFieldsFragmentDoc,
    fragmentName: 'MediaSummaryFields',
    data: title,
  })
  if (reference) (cache as InMemoryCache).release(reference.__ref)
  return reference
}

/** Writes a page's library fields, which every page carries alongside its titles. */
export function refreshLibrary(
  cache: ApolloCache,
  library: Omit<LibraryPageQuery['library'], 'items'>,
) {
  cache.modify({
    id: cache.identify({ __typename: 'Library', id: library.id }),
    fields: {
      name: () => library.name,
      status: () => library.status,
      scanCompletedOn: () => library.scanCompletedOn,
      itemCount: () => library.itemCount,
      alphabetIndex: () => library.alphabetIndex,
    },
  })
}
