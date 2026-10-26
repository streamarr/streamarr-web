import type { ApolloCache, Reference } from '@apollo/client'

// The server orders no changes across fields: a change committed before a removal can arrive
// after it. A Library id never returns once removed, so each cache keeps every removal.
const removalsByCache = new WeakMap<ApolloCache, Set<string>>()

function removalsIn(cache: ApolloCache): Set<string> {
  let removals = removalsByCache.get(cache)
  if (!removals) {
    removals = new Set()
    removalsByCache.set(cache, removals)
  }
  return removals
}

/** Whether the cache applied the Library's removal. */
export function isRemovedLibrary(cache: ApolloCache, libraryId: string): boolean {
  return removalsByCache.get(cache)?.has(libraryId) ?? false
}

/**
 * Every cached Library list gains the Library once, unless the cache applied its removal. The
 * Library itself is already cached.
 */
export function addUnlessRemoved(
  cache: ApolloCache,
  library: { __typename: 'Library'; id: string },
) {
  if (isRemovedLibrary(cache, library.id)) return
  cache.modify<{ libraries: readonly Reference[] }>({
    fields: {
      libraries: (existing, { readField, toReference }) => {
        if (existing.some((held) => readField('id', held) === library.id)) return existing
        const added = toReference(library)
        return added ? [...existing, added] : existing
      },
    },
  })
}

/** Every cached Library list drops the Library, and no later change adds it back. */
export function removeLibraryForGood(cache: ApolloCache, libraryId: string) {
  removalsIn(cache).add(libraryId)
  removeFromLibraryLists(cache, libraryId)
}

function removeFromLibraryLists(cache: ApolloCache, libraryId: string) {
  cache.modify<{ libraries: readonly Reference[] }>({
    fields: {
      libraries: (existing, { readField }) =>
        existing.filter((library) => readField('id', library) !== libraryId),
    },
  })
}
