import type { ApolloCache, ApolloClient, ErrorLike, Reference } from '@apollo/client'
import { useApolloClient, useQuery, useSubscription } from '@apollo/client/react'
import { useEffect, useRef, useState } from 'react'
import {
  AddLibraryDocument,
  AdminLibrariesDocument,
  LibraryAddedDocument,
  LibraryRemovedDocument,
  LibraryStatusChangedDocument,
  RefreshLibraryDocument,
  RemoveLibraryDocument,
  ScanLibraryDocument,
  type AddLibraryInput,
  type ImageRefreshMode,
  type ManagedLibraryFieldsFragment,
} from '../../graphql/generated/graphql'
import { extractAuthContext } from '../../graphql/errorRouting'

/** Why live inventory changes stopped: the server refused them, or they ended another way. */
export type LiveInventoryStop = 'forbidden' | 'failed'

/**
 * Applies every library change as it commits: status and scan times update in place, an added
 * library joins the inventory once, and a removed one leaves it. The server replays nothing a
 * late subscriber missed, so the inventory reads again once these operations subscribe.
 */
export function useLiveInventoryChanges(): LiveInventoryStop | null {
  const [stop, setStop] = useState<LiveInventoryStop | null>(null)
  const onError = (error: ErrorLike) => setStop(isForbidden(error) ? 'forbidden' : 'failed')
  const holdFrom = (library: ManagedLibraryFieldsFragment | undefined, cache: ApolloCache) => {
    if (library) holdLibrary(cache, library)
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
      if (removal) dropLibrary(client.cache, removal.libraryId)
    },
    onError,
  })
  return stop
}

/**
 * The inventory as of entry or reload, kept current by live changes: no polling and no refetch
 * on focus. A failed refetch keeps the last inventory, so callers disable maintenance while
 * `error` is set.
 */
export function useAdminLibraries() {
  const query = useQuery(AdminLibrariesDocument, {
    fetchPolicy: 'cache-and-network',
  })
  return { ...query, data: query.data ?? query.previousData }
}

/**
 * One in-flight library command per caller. A null result means the request failed, was a
 * duplicate, or outlived the caller; creation's userErrors ride the returned payload. Scan and
 * refresh success means the server accepted the request, not that it finished.
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
    scan: (id: string) =>
      execute(async () => {
        const { data } = await client.mutate({ mutation: ScanLibraryDocument, variables: { id } })
        if (data?.scanLibrary !== true) throw new Error('Scan was not accepted')
        return true
      }),
    refresh: (id: string, imageRefreshMode: ImageRefreshMode) =>
      execute(async () => {
        const { data } = await client.mutate({
          mutation: RefreshLibraryDocument,
          variables: { id, imageRefreshMode },
        })
        if (data?.refreshLibrary !== true) throw new Error('Refresh was not accepted')
        return true
      }),
    remove: (id: string, onRemoved: () => void) =>
      execute(async () => {
        const { data } = await client.mutate({ mutation: RemoveLibraryDocument, variables: { id } })
        if (data?.removeLibrary !== true) throw new Error('Removal was not confirmed')
        if (active.current) onRemoved()
        refreshLibraryViews(client, id)
        return true
      }),
  }
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
