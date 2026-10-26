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
