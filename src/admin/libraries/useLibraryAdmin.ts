import type { ApolloCache, ApolloClient, Reference } from '@apollo/client'
import { useApolloClient, useQuery } from '@apollo/client/react'
import { useEffect, useRef, useState } from 'react'
import {
  AddLibraryDocument,
  AdminLibrariesDocument,
  RefreshLibraryDocument,
  RemoveLibraryDocument,
  ScanLibraryDocument,
  type AddLibraryInput,
  type ImageRefreshMode,
} from '../../graphql/generated/graphql'
import { extractAuthContext } from '../../graphql/errorRouting'

/**
 * The inventory as of entry or reload: no polling and no refetch on focus. A failed refetch
 * keeps the last inventory, so callers disable maintenance while `error` is set.
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
      const context = extractAuthContext(error)
      const denied =
        context.graphqlCodes?.includes('FORBIDDEN') || context.networkCode === 'FORBIDDEN'
      if (active.current)
        setFailure(
          denied
            ? 'You no longer have permission to manage libraries.'
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
