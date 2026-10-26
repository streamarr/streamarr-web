import type { ApolloClient, ErrorLike } from '@apollo/client'
import {
  LibraryAddedDocument,
  LibraryRemovedDocument,
  LibraryStatusChangedDocument,
  type LibraryFieldsFragment,
} from '../graphql/generated/graphql'
import { addUnlessRemoved, removeLibraryForGood } from '../graphql/libraryLists'
import { stopTogether, watchLiveChanges } from '../graphql/liveChanges'

/** What a view adds to applying Library changes: its own reaction to each one. */
export interface LibraryChangeListener {
  /** Runs before the cache applies a change that concerns the Library. */
  onChange?: (libraryId: string) => void
  /** Runs after every cached Library list dropped the removed Library. */
  onRemoved?: (libraryId: string) => void
  /** Runs when the server refuses or ends one of the changes. */
  onStop?: (error: ErrorLike) => void
}

/**
 * Applies every Library's status changes, additions and removals to the cache until the returned
 * function runs. Normalization carries a Library's status, scan times and name to every view of
 * it; an added Library joins each cached Library list once, and a removed one leaves them for
 * good, for every view of the same cache. A refusal or a normal end stops the changes; the views
 * keep what they last read.
 */
export function subscribeToLibraryChanges(
  client: ApolloClient,
  { onChange, onRemoved, onStop }: LibraryChangeListener = {},
): () => void {
  const { cache } = client
  const applyLibrary = (library: LibraryFieldsFragment | null) => {
    if (!library) return
    onChange?.(library.id)
    addUnlessRemoved(cache, library)
  }
  const applyRemoval = (removal: { libraryId: string } | null) => {
    if (!removal) return
    onChange?.(removal.libraryId)
    removeLibraryForGood(cache, removal.libraryId)
    onRemoved?.(removal.libraryId)
  }
  return stopTogether([
    watchLiveChanges(client, LibraryStatusChangedDocument, {
      apply: (data) => applyLibrary(data.libraryStatusChanged),
      onStop,
    }),
    watchLiveChanges(client, LibraryAddedDocument, {
      apply: (data) => applyLibrary(data.libraryAdded),
      onStop,
    }),
    watchLiveChanges(client, LibraryRemovedDocument, {
      apply: (data) => applyRemoval(data.libraryRemoved),
      onStop,
    }),
  ])
}
