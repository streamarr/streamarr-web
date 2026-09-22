import type { ApolloClient } from '@apollo/client'
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
 * Library inventory fetched on workspace entry. Status changes require a page reload;
 * there is no polling, focus refresh, or subscription. Confirmed creation/removal separately
 * synchronizes the inventory. Failed requests retain the last inventory for context;
 * callers must disable maintenance until a successful explicit retry.
 */
export function useAdminLibraries() {
  const query = useQuery(AdminLibrariesDocument, {
    fetchPolicy: 'cache-and-network',
  })
  return { ...query, data: query.data ?? query.previousData }
}

/**
 * Library commands with one in-flight request per mounted caller. No optimistic server status
 * or removal is invented. A null result means failure, duplicate submission, or an unmounted
 * caller; creation userErrors remain in the returned payload for field-level rendering.
 * Scan/refresh success means accepted, not completed; neither command refetches status.
 * Creation/removal synchronize cached lists. Cache refresh failure never turns an acknowledged
 * mutation into a reported mutation failure (which could encourage a duplicate).
 * Removal calls onRemoved before invalidating inventory, since that invalidation may unmount
 * the selected detail pane. Callers must not start another mutation from that callback.
 */
export function useLibraryCommands() {
  const client = useApolloClient()
  const active = useRef(true)
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    setError(null)
    try {
      const result = await operation()
      return active.current ? result : null
    } catch (caught) {
      const context = extractAuthContext(caught)
      const denied =
        context.graphqlCodes?.includes('FORBIDDEN') || context.networkCode === 'FORBIDDEN'
      if (active.current)
        setError(
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
    error,
    clearError: () => setError(null),
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
        for (const fieldName of [
          'libraries',
          'library',
          'continueWatching',
          'movie',
          'series',
          'season',
        ]) {
          cache.evict({ id: 'ROOT_QUERY', fieldName })
        }
        if (removedId) cache.evict({ id: cache.identify({ __typename: 'Library', id: removedId }) })
        cache.gc()
      },
    })
    .catch(() => {})
}
