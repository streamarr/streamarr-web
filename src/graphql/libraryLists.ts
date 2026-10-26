import type { ApolloCache, Reference } from '@apollo/client'

/** Every cached Library list gains the Library once. The Library itself is already cached. */
export function addToLibraryLists(
  cache: ApolloCache,
  library: { __typename: 'Library'; id: string },
) {
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

/** Every cached Library list drops the Library. */
export function removeFromLibraryLists(cache: ApolloCache, libraryId: string) {
  cache.modify<{ libraries: readonly Reference[] }>({
    fields: {
      libraries: (existing, { readField }) =>
        existing.filter((library) => readField('id', library) !== libraryId),
    },
  })
}

// Root fields that hold titles, or the details of titles, which any Library may have fed.
const TITLE_FIELDS = ['continueWatching', 'movie', 'series', 'season', 'episode']

/**
 * Forgets the cached views a Library's titles may feed: Continue Watching and media details. The
 * views that show them read again; inactive ones read when they next open.
 */
export function forgetTitleViews(cache: ApolloCache) {
  for (const fieldName of TITLE_FIELDS) cache.evict({ id: 'ROOT_QUERY', fieldName })
  cache.gc()
}

/**
 * Removes a Library from every cached view: each Library list drops it, the Library itself is
 * forgotten, and so are the views its titles may have fed (`forgetTitleViews`).
 */
export function removeFromLibraryViews(cache: ApolloCache, libraryId: string) {
  removeFromLibraryLists(cache, libraryId)
  cache.evict({ id: cache.identify({ __typename: 'Library', id: libraryId }) })
  forgetTitleViews(cache)
}
