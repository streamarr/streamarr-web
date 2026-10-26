import type { ApolloClient, ErrorLike, TypedDocumentNode } from '@apollo/client'
import {
  LibraryAddedDocument,
  LibraryRemovedDocument,
  LibraryStatusChangedDocument,
  type LibraryFieldsFragment,
} from '../graphql/generated/graphql'
import { addToLibraryLists, removeFromLibraryLists } from '../graphql/libraryLists'

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
 * it; an added Library joins each cached Library list once, and a removed one leaves them, for
 * every view of the same cache. A refusal or a normal end stops the changes; the views keep what
 * they last read.
 */
export function subscribeToLibraryChanges(
  client: ApolloClient,
  { onChange, onRemoved, onStop }: LibraryChangeListener = {},
): () => void {
  const { cache } = client
  const applyLibrary = (library: LibraryFieldsFragment | null) => {
    if (!library) return
    onChange?.(library.id)
    addToLibraryLists(cache, library)
  }
  const applyRemoval = (removal: { libraryId: string } | null) => {
    if (!removal) return
    onChange?.(removal.libraryId)
    removeFromLibraryLists(cache, removal.libraryId)
    onRemoved?.(removal.libraryId)
  }
  const stops = [
    subscribeToLibraryChange(client, LibraryStatusChangedDocument, {
      apply: (data) => applyLibrary(data.libraryStatusChanged),
      onStop,
    }),
    subscribeToLibraryChange(client, LibraryAddedDocument, {
      apply: (data) => applyLibrary(data.libraryAdded),
      onStop,
    }),
    subscribeToLibraryChange(client, LibraryRemovedDocument, {
      apply: (data) => applyRemoval(data.libraryRemoved),
      onStop,
    }),
  ]
  return () => stops.forEach((stop) => stop())
}

/**
 * Runs one Library change subscription through the shared transport and applies each change it
 * delivers until the returned function runs. With errorPolicy 'all', a change whose field failed
 * arrives with its errors, and the operation keeps running: the change applies whatever data it
 * carries, a null field carries none, and the transport reports the change missed so the active
 * queries read again. A result without data ends the operation and reaches `onStop`, if given.
 */
function subscribeToLibraryChange<TData>(
  client: ApolloClient,
  query: TypedDocumentNode<TData, Record<string, never>>,
  { apply, onStop }: { apply: (data: TData) => void; onStop?: (error: ErrorLike) => void },
): () => void {
  let stopped = false
  const subscription = client
    .subscribe({ query, errorPolicy: 'all' })
    .subscribe(({ data, error }) => {
      if (stopped) return
      if (data) {
        apply(data)
        return
      }
      if (error) onStop?.(error)
    })
  // A remount that subscribes before this task runs joins the same operation, as useSubscription's
  // does, instead of ending it and starting another.
  return () => {
    stopped = true
    setTimeout(() => subscription.unsubscribe())
  }
}
