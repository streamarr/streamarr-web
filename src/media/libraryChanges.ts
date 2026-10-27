import type { ApolloClient, ErrorLike, TypedDocumentNode } from '@apollo/client'
import {
  AdminLibraryAddedDocument,
  LibraryAddedDocument,
  LibraryRemovedDocument,
  LibraryStatusChangedDocument,
  type LibraryFieldsFragment,
} from '../graphql/generated/graphql'
import { addToLibraryLists, removeFromLibraryViews } from '../graphql/libraryLists'

/** What a view adds to applying Library changes: its own reaction to each one. */
export interface LibraryChangeListener {
  /** Runs before the cache applies a change that concerns the Library. */
  onChange?: (libraryId: string) => void
  /** Runs when the server refuses or ends one of the changes. */
  onStop?: (error: ErrorLike) => void
}

/**
 * Applies every Library's additions and removals to the cache until the returned function runs:
 * an added Library joins each cached Library list once, and a removed one leaves every cached view,
 * together with the Continue Watching and media details its titles may have fed, which read again
 * (`removeFromLibraryViews`). Every selected Profile may receive these changes, and an added Library
 * carries only what every Profile reads, never its administration. A refusal or a normal end stops
 * the changes; the views keep what they last read.
 */
export function subscribeToLibraryChanges(
  client: ApolloClient,
  listener: LibraryChangeListener = {},
): () => void {
  const changes = libraryChangeAppliers(client, listener)
  const stops = [
    subscribeToLibraryChange(client, LibraryAddedDocument, {
      apply: (data) => changes.applyLibrary(data.libraryAdded),
      onStop: listener.onStop,
    }),
    subscribeToLibraryRemovals(client, changes, listener),
  ]
  return () => stops.forEach((stop) => stop())
}

/**
 * Applies every Library's status changes, additions and removals to the cache until the returned
 * function runs. Only a session that may administer the server (`canManageServer`) may receive
 * status changes or read a Library's administration. Each change carries the Library's
 * administration, so an added Library holds every field the administration inventory reads, and
 * normalization carries a Library's status, scan times and name to every view of it. Additions and
 * removals reach each cached Library list as `subscribeToLibraryChanges` says.
 */
export function subscribeToAdministeredLibraryChanges(
  client: ApolloClient,
  listener: LibraryChangeListener = {},
): () => void {
  const changes = libraryChangeAppliers(client, listener)
  const stops = [
    subscribeToLibraryChange(client, LibraryStatusChangedDocument, {
      apply: (data) => changes.applyLibrary(data.libraryStatusChanged),
      onStop: listener.onStop,
    }),
    subscribeToLibraryChange(client, AdminLibraryAddedDocument, {
      apply: (data) => changes.applyLibrary(data.libraryAdded),
      onStop: listener.onStop,
    }),
    subscribeToLibraryRemovals(client, changes, listener),
  ]
  return () => stops.forEach((stop) => stop())
}

type LibraryChangeAppliers = ReturnType<typeof libraryChangeAppliers>

function libraryChangeAppliers(client: ApolloClient, { onChange }: LibraryChangeListener) {
  const { cache } = client
  return {
    applyLibrary(library: LibraryFieldsFragment | null) {
      if (!library) return
      onChange?.(library.id)
      addToLibraryLists(cache, library)
    },
    applyRemoval(removal: { libraryId: string } | null) {
      if (!removal) return
      onChange?.(removal.libraryId)
      removeFromLibraryViews(cache, removal.libraryId)
    },
  }
}

function subscribeToLibraryRemovals(
  client: ApolloClient,
  changes: LibraryChangeAppliers,
  { onStop }: LibraryChangeListener,
): () => void {
  return subscribeToLibraryChange(client, LibraryRemovedDocument, {
    apply: (data) => changes.applyRemoval(data.libraryRemoved),
    onStop,
  })
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
