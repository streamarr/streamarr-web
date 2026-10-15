import type { ApolloCache, ApolloClient, ErrorLike, Reference } from '@apollo/client'
import { useApolloClient, useQuery, useSubscription } from '@apollo/client/react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  AddLibraryDocument,
  AdminLibrariesDocument,
  LibraryAddedDocument,
  LibraryRemovedDocument,
  LibraryStatusChangedDocument,
  RemoveLibraryDocument,
  StartLibraryRefreshDocument,
  StartLibraryScanDocument,
  type AddLibraryInput,
  type ImageRefreshMode,
  type LibraryStatus,
  type ManagedLibraryFieldsFragment,
  type StartLibraryScanMutation,
} from '../../graphql/generated/graphql'
import { extractAuthContext } from '../../graphql/errorRouting'
import { userErrorMessage } from '../../graphql/userErrors'

// Scan, refresh and removal share one refusal union.
type LibraryOperationError = NonNullable<
  StartLibraryScanMutation['startLibraryScan']
>['userErrors'][number]

/** Why live inventory changes stopped: the server refused them, or they ended another way. */
export type LiveInventoryStop = 'forbidden' | 'failed'

// Applies every library change as it commits: status and scan times update in place, an added
// library joins the inventory once, and a removed one leaves it for good.
function useLiveInventoryChanges(): {
  stop: LiveInventoryStop | null
  removedIds: RefObject<ReadonlySet<string>>
} {
  const [stop, setStop] = useState<LiveInventoryStop | null>(null)
  // The server orders no frames across fields: a change committed before a removal can arrive
  // after it. A library id never returns once removed.
  const removedIds = useRef(new Set<string>())
  const onError = (error: ErrorLike) => setStop(isForbidden(error) ? 'forbidden' : 'failed')
  const holdFrom = (library: ManagedLibraryFieldsFragment | undefined, cache: ApolloCache) => {
    if (library && !removedIds.current.has(library.id)) holdLibrary(cache, library)
  }
  useSubscription(LibraryStatusChangedDocument, {
    ignoreResults: true,
    onData: ({ client, data }) => holdFrom(data.data?.libraryStatusChanged, client.cache),
    onError,
  })
  useSubscription(LibraryAddedDocument, {
    ignoreResults: true,
    onData: ({ client, data }) => holdFrom(data.data?.libraryAdded, client.cache),
    onError,
  })
  useSubscription(LibraryRemovedDocument, {
    ignoreResults: true,
    onData: ({ client, data }) => {
      const removal = data.data?.libraryRemoved
      if (!removal) return
      removedIds.current.add(removal.libraryId)
      dropLibrary(client.cache, removal.libraryId)
    },
    onError,
  })
  return { stop, removedIds }
}

/**
 * The inventory as of entry or reload, kept current by live changes: no polling and no refetch
 * on focus. A failed refetch keeps the last inventory, so callers disable maintenance while
 * `error` is set. `liveStop` says why live changes stopped, if they did. The server replays
 * nothing a late subscriber missed, so the inventory reads again once the changes subscribe.
 */
export function useAdminLibraries() {
  const { stop: liveStop, removedIds } = useLiveInventoryChanges()
  const query = useQuery(AdminLibrariesDocument, {
    fetchPolicy: 'cache-and-network',
  })
  const { client, data } = query
  // A read that took its snapshot before a removal can land after it.
  useEffect(() => {
    for (const library of data?.libraries ?? []) {
      if (removedIds.current.has(library.id)) dropLibrary(client.cache, library.id)
    }
  }, [client, data, removedIds])
  return { ...query, data: data ?? query.previousData, liveStop }
}

/**
 * One in-flight library command per caller. A null result means the request failed, was refused,
 * was a duplicate, or outlived the caller; creation's userErrors ride the returned payload. Scan
 * and refresh success means the server started the operation, not that it finished: the returned
 * library already shows the busy status.
 */
export function useLibraryCommands() {
  const client = useApolloClient()
  const active = useRef(true)
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  async function execute<T>(operation: () => Promise<T>): Promise<T | null> {
    if (inFlight.current) return null
    inFlight.current = true
    setPending(true)
    setFailure(null)
    try {
      const result = await operation()
      return active.current ? result : null
    } catch (error) {
      if (active.current)
        setFailure(
          isForbidden(error)
            ? NO_LONGER_PERMITTED
            : "Couldn't confirm the operation. Refresh the page to check the library state before trying again.",
        )
      return null
    } finally {
      inFlight.current = false
      if (active.current) setPending(false)
    }
  }

  // The payload when the server did what was asked; a refusal shows its message instead.
  function accepted<P extends { userErrors: readonly LibraryOperationError[] }>(
    libraryId: string,
    payload: P | null | undefined,
  ): P | null {
    if (!payload) throw new Error('Missing library operation result')
    if (payload.userErrors.length === 0) return payload
    for (const error of payload.userErrors) {
      if (error.__typename === 'LibraryBusyError') showStatus(client.cache, libraryId, error.status)
    }
    if (active.current) setFailure(payload.userErrors.map(userErrorMessage).join(' '))
    return null
  }

  return {
    pending,
    error: failure,
    clearError: () => setFailure(null),
    create: (input: AddLibraryInput) =>
      execute(async () => {
        const { data } = await client.mutate({ mutation: AddLibraryDocument, variables: { input } })
        if (!data?.addLibrary) throw new Error('Missing creation result')
        if (data.addLibrary.library && data.addLibrary.userErrors.length === 0)
          refreshLibraryViews(client)
        return data.addLibrary
      }),
    scan: (libraryId: string) =>
      execute(async () => {
        const { data } = await client.mutate({
          mutation: StartLibraryScanDocument,
          variables: { input: { libraryId } },
        })
        return startedLibrary(accepted(libraryId, data?.startLibraryScan))
      }),
    refresh: (libraryId: string, imageRefreshMode: ImageRefreshMode) =>
      execute(async () => {
        const { data } = await client.mutate({
          mutation: StartLibraryRefreshDocument,
          variables: { input: { libraryId, imageRefreshMode } },
        })
        return startedLibrary(accepted(libraryId, data?.startLibraryRefresh))
      }),
    remove: (libraryId: string, onRemoved: () => void) =>
      execute(async () => {
        const { data } = await client.mutate({
          mutation: RemoveLibraryDocument,
          variables: { input: { libraryId } },
        })
        const payload = accepted(libraryId, data?.removeLibrary)
        if (!payload) return null
        if (!payload.removedLibraryId) throw new Error('Removal was not confirmed')
        if (active.current) onRemoved()
        refreshLibraryViews(client, payload.removedLibraryId)
        return payload.removedLibraryId
      }),
  }
}

// Normalization has already written the returned library, busy status included, into the cache.
function startedLibrary(
  payload: { library: ManagedLibraryFieldsFragment | null } | null,
): ManagedLibraryFieldsFragment | null {
  if (!payload) return null
  if (!payload.library) throw new Error('Missing started library')
  return payload.library
}

function refreshLibraryViews(client: ApolloClient, removedId?: string) {
  // Evict inactive query fields too: returning Home or following an old library link must not
  // resurrect an inventory or media detail cached before a creation/removal operation.
  void client
    .refetchQueries({
      updateCache(cache) {
        if (removedId) dropLibrary(cache, removedId)
        else cache.evict({ id: 'ROOT_QUERY', fieldName: 'libraries' })
        for (const fieldName of ['library', 'continueWatching', 'movie', 'series', 'season']) {
          cache.evict({ id: 'ROOT_QUERY', fieldName })
        }
        cache.gc()
      },
    })
    .catch(() => {})
}

/** The message for a refusal that says the admin lost the right to manage libraries. */
export const NO_LONGER_PERMITTED = 'You no longer have permission to manage libraries.'

function isForbidden(error: unknown): boolean {
  const context = extractAuthContext(error)
  return !!context.graphqlCodes?.includes('FORBIDDEN') || context.networkCode === 'FORBIDDEN'
}

// The change already wrote the library itself; every cached library list gains it once.
function holdLibrary(cache: ApolloCache, library: ManagedLibraryFieldsFragment) {
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

// A busy refusal names no library, so normalization cannot apply the status it carries.
function showStatus(cache: ApolloCache, libraryId: string, status: LibraryStatus) {
  cache.modify<ManagedLibraryFieldsFragment>({
    id: cache.identify({ __typename: 'Library', id: libraryId }),
    fields: { status: () => status },
  })
}

// Every cached library list drops the library at once; the refetch then confirms the inventory.
function dropLibrary(cache: ApolloCache, id: string) {
  cache.modify<{ libraries: readonly Reference[] }>({
    fields: {
      libraries: (existing, { readField }) =>
        existing.filter((library) => readField('id', library) !== id),
    },
  })
  cache.evict({ id: cache.identify({ __typename: 'Library', id }) })
}
