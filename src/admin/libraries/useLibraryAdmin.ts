import type { ApolloCache, ApolloClient, ErrorLike, Reference } from '@apollo/client'
import { useApolloClient, useQuery, useSubscription } from '@apollo/client/react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  AddLibraryDocument,
  AdminLibrariesDocument,
  LibraryAddedDocument,
  LibraryRemovedDocument,
  LibraryStatusChangedDocument,
  ManagedLibraryFieldsFragmentDoc,
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

type LibraryOperationPayload = {
  library?: ManagedLibraryFieldsFragment | null
  userErrors: readonly LibraryOperationError[]
}

// The server orders no live change against a mutation response: a run can end, and its live
// change arrive, before the response that started or refused the run. Each cache counts the live
// changes it applied for each library, so a command can tell whether one arrived meanwhile.
const liveChangeCounts = new WeakMap<ApolloCache, Map<string, number>>()

function liveChangeCount(cache: ApolloCache, libraryId: string): number {
  return liveChangeCounts.get(cache)?.get(libraryId) ?? 0
}

function countLiveChange(cache: ApolloCache, libraryId: string) {
  let counts = liveChangeCounts.get(cache)
  if (!counts) {
    counts = new Map()
    liveChangeCounts.set(cache, counts)
  }
  counts.set(libraryId, liveChangeCount(cache, libraryId) + 1)
}

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
    if (!library) return
    countLiveChange(cache, library.id)
    if (!removedIds.current.has(library.id)) holdLibrary(cache, library)
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
      countLiveChange(client.cache, removal.libraryId)
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
 * library shows the busy status unless a live change already reported that the run ended.
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

  async function execute<T>(
    operation: () => Promise<T>,
    nothingStarted = NOTHING_STARTED,
  ): Promise<T | null> {
    if (inFlight.current) return null
    inFlight.current = true
    setPending(true)
    setFailure(null)
    try {
      const result = await operation()
      return active.current ? result : null
    } catch (error) {
      if (active.current) setFailure(failureMessage(error, nothingStarted))
      return null
    } finally {
      inFlight.current = false
      if (active.current) setPending(false)
    }
  }

  // The payload when the server did what was asked; a refusal shows its message instead.
  function accepted<P extends LibraryOperationPayload>(payload: P | null | undefined): P | null {
    if (!payload) throw new Error('Missing library operation result')
    if (payload.userErrors.length === 0) return payload
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
        const { library, userErrors } = data.addLibrary
        if (library && userErrors.length === 0)
          refreshLibraryViews(client, (cache) => holdLibrary(cache, library))
        return data.addLibrary
      }, NOTHING_ADDED),
    scan: (libraryId: string) =>
      execute(async () => {
        const writeOutcome = outcomeWriter(client.cache, libraryId)
        const { data } = await client.mutate({
          mutation: StartLibraryScanDocument,
          variables: { input: { libraryId } },
          fetchPolicy: 'no-cache',
          update: (cache, { data }) => writeOutcome(cache, data?.startLibraryScan),
        })
        return startedLibrary(client.cache, accepted(data?.startLibraryScan))
      }),
    refresh: (libraryId: string, imageRefreshMode: ImageRefreshMode) =>
      execute(async () => {
        const writeOutcome = outcomeWriter(client.cache, libraryId)
        const { data } = await client.mutate({
          mutation: StartLibraryRefreshDocument,
          variables: { input: { libraryId, imageRefreshMode } },
          fetchPolicy: 'no-cache',
          update: (cache, { data }) => writeOutcome(cache, data?.startLibraryRefresh),
        })
        return startedLibrary(client.cache, accepted(data?.startLibraryRefresh))
      }),
    remove: (libraryId: string, onRemoved: () => void) =>
      execute(async () => {
        const writeOutcome = outcomeWriter(client.cache, libraryId)
        const { data } = await client.mutate({
          mutation: RemoveLibraryDocument,
          variables: { input: { libraryId } },
          update: (cache, { data }) => writeOutcome(cache, data?.removeLibrary),
        })
        const payload = accepted(data?.removeLibrary)
        if (!payload) return null
        if (!payload.removedLibraryId) throw new Error('Removal was not confirmed')
        if (active.current) onRemoved()
        const { removedLibraryId } = payload
        refreshLibraryViews(client, (cache) => dropLibrary(cache, removedLibraryId))
        return payload.removedLibraryId
      }),
  }
}

// A live change that arrived during the request is newer than the returned library.
function startedLibrary(
  cache: ApolloCache,
  payload: LibraryOperationPayload | null,
): ManagedLibraryFieldsFragment | null {
  if (!payload) return null
  if (!payload.library) throw new Error('Missing started library')
  const id = cache.identify(payload.library)
  return cache.readFragment({ fragment: ManagedLibraryFieldsFragmentDoc, id }) ?? payload.library
}

// The returned library, or the status a busy refusal carries, writes into the cache unless a live
// change for the library arrived during the request: that change can already say the run ended.
// The write happens in the mutation's own cache update, so the library shows its new status by
// the time the command returns.
function outcomeWriter(cache: ApolloCache, libraryId: string) {
  const liveChangesBefore = liveChangeCount(cache, libraryId)
  return (target: ApolloCache, payload: LibraryOperationPayload | null | undefined) => {
    if (!payload || liveChangeCount(target, libraryId) !== liveChangesBefore) return
    if (payload.library)
      target.writeFragment({ fragment: ManagedLibraryFieldsFragmentDoc, data: payload.library })
    for (const error of payload.userErrors) {
      if (error.__typename === 'LibraryBusyError') showStatus(target, libraryId, error.status)
    }
  }
}

// The inventory changes at once from the payload; the refetch then confirms it.
function refreshLibraryViews(client: ApolloClient, changeInventory: (cache: ApolloCache) => void) {
  // Evict inactive query fields too: returning Home or following an old library link must not
  // resurrect media detail cached before a creation/removal operation.
  void client
    .refetchQueries({
      updateCache(cache) {
        changeInventory(cache)
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

// The server rolled back everything the request wrote, so these failures have a known outcome.
const NOTHING_STARTED = 'Nothing started. The library is unchanged. Try again.'
const NOTHING_ADDED = 'Nothing started. The library was not added. Try again.'

function failureMessage(error: unknown, nothingStarted: string): string {
  if (isForbidden(error)) return NO_LONGER_PERMITTED
  if (extractAuthContext(error).graphqlCodes?.includes('LIBRARY_OPERATION_NOT_STARTED'))
    return nothingStarted
  return "Couldn't confirm the operation. Refresh the page to check the library state before trying again."
}

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
