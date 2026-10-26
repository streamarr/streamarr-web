import type { ApolloClient } from '@apollo/client'
import {
  LibraryAddedDocument,
  LibraryRemovedDocument,
  LibraryStatusChangedDocument,
  type LibraryFieldsFragment,
} from '../graphql/generated/graphql'
import { stopTogether, watchLiveChanges } from '../graphql/liveChanges'
import { addToLibraryLists, removeFromLibraryLists } from '../graphql/libraryLists'

/**
 * Applies every Library's status changes, additions and removals to the cache until the returned
 * function runs. Normalization carries a Library's status, scan times and name to every view of
 * it; an added Library joins each cached Library list once, and a removed one leaves them. A
 * refusal or a normal end stops the changes; the views keep what they last read.
 */
export function subscribeToLibraryChanges(client: ApolloClient): () => void {
  // The server orders no changes across fields: a change committed before a removal can arrive
  // after it. A Library id never returns once removed.
  const removedIds = new Set<string>()
  const addUnlessRemoved = (library: LibraryFieldsFragment | null) => {
    if (library && !removedIds.has(library.id)) addToLibraryLists(client.cache, library)
  }
  return stopTogether([
    watchLiveChanges(client, LibraryStatusChangedDocument, {
      apply: (data) => addUnlessRemoved(data.libraryStatusChanged),
    }),
    watchLiveChanges(client, LibraryAddedDocument, {
      apply: (data) => addUnlessRemoved(data.libraryAdded),
    }),
    watchLiveChanges(client, LibraryRemovedDocument, {
      apply: ({ libraryRemoved }) => {
        if (!libraryRemoved) return
        removedIds.add(libraryRemoved.libraryId)
        removeFromLibraryLists(client.cache, libraryRemoved.libraryId)
      },
    }),
  ])
}
