import type {
  ApolloCache,
  ApolloClient,
  ErrorLike,
  OperationVariables,
  Reference,
  TypedDocumentNode,
} from '@apollo/client'
import { useApolloClient, useQuery } from '@apollo/client/react'
import { useRouteContext } from '@tanstack/react-router'
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
  StopLibraryRefreshDocument,
  StopLibraryScanDocument,
  type AddLibraryInput,
  type ImageRefreshMode,
  type LibraryStatus,
  type ManagedLibraryFieldsFragment,
  type StartLibraryScanMutation,
  type StopLibraryRefreshMutation,
  type StopLibraryScanMutation,
} from '../../graphql/generated/graphql'
import { extractAuthContext } from '../../graphql/errorRouting'
import { userErrorMessage } from '../../graphql/userErrors'

// Starts and removal share one refusal union; each stop adds its own refusal for a run that is
// not in progress.
type LibraryOperationError =
  | NonNullable<StartLibraryScanMutation['startLibraryScan']>['userErrors'][number]
  | NonNullable<StopLibraryScanMutation['stopLibraryScan']>['userErrors'][number]
  | NonNullable<StopLibraryRefreshMutation['stopLibraryRefresh']>['userErrors'][number]

type LibraryOperationPayload = {
  library?: ManagedLibraryFieldsFragment | null
  userErrors: readonly LibraryOperationError[]
}

// A socket that subscribes again ends a gap whose changes reached no operation, and a change with
// a failed field arrives without its library: either can concern any library. A response to a
// request sent before then no longer settles the library's status on its own.
const EVERY_LIBRARY = Symbol('every library')

// The server orders no live change against a mutation response: a run can end, and its live
// change arrive, before the response that started or refused the run. Each cache counts the live
// changes it applied for each library, so a command can tell whether one arrived meanwhile.
type LiveChangeTarget = string | typeof EVERY_LIBRARY
const liveChangeCounts = new WeakMap<ApolloCache, Map<LiveChangeTarget, number>>()

function countedLiveChanges(cache: ApolloCache, target: LiveChangeTarget): number {
  return liveChangeCounts.get(cache)?.get(target) ?? 0
}

function liveChangeCount(cache: ApolloCache, libraryId: string): number {
  return countedLiveChanges(cache, libraryId) + missedChangeCount(cache)
}

function missedChangeCount(cache: ApolloCache): number {
  return countedLiveChanges(cache, EVERY_LIBRARY)
}

function countLiveChange(cache: ApolloCache, target: LiveChangeTarget) {
  let counts = liveChangeCounts.get(cache)
  if (!counts) {
    counts = new Map()
    liveChangeCounts.set(cache, counts)
  }
  counts.set(target, countedLiveChanges(cache, target) + 1)
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
  const client = useApolloClient()
  const { subscriptions } = useRouteContext({ from: '__root__' })
  useEffect(
    () => subscriptions.onMissedChanges(() => countLiveChange(client.cache, EVERY_LIBRARY)),
    [client, subscriptions],
  )
  // The server orders no frames across fields: a change committed before a removal can arrive
  // after it. A library id never returns once removed.
  const removedIds = useRef(new Set<string>())
  useEffect(() => {
    const onStop = (error: ErrorLike) => setStop(isForbidden(error) ? 'forbidden' : 'failed')
    const holdFrom = (library: ManagedLibraryFieldsFragment | null) => {
      if (!library) return
      countLiveChange(client.cache, library.id)
      if (!removedIds.current.has(library.id)) holdLibrary(client.cache, library)
    }
    const dropFrom = (removal: { libraryId: string } | null) => {
      if (!removal) return
      removedIds.current.add(removal.libraryId)
      countLiveChange(client.cache, removal.libraryId)
      dropLibrary(client.cache, removal.libraryId)
    }
    const unwatch = [
      watchLiveChanges(client, LibraryStatusChangedDocument, {
        apply: (data) => holdFrom(data.libraryStatusChanged),
        onStop,
      }),
      watchLiveChanges(client, LibraryAddedDocument, {
        apply: (data) => holdFrom(data.libraryAdded),
        onStop,
      }),
      watchLiveChanges(client, LibraryRemovedDocument, {
        apply: (data) => dropFrom(data.libraryRemoved),
        onStop,
      }),
    ]
    return () => {
      for (const stopWatching of unwatch) stopWatching()
    }
  }, [client])
  return { stop, removedIds }
}

// With errorPolicy 'all', a change whose field failed arrives with its errors, and the operation
// keeps running: the change applies whatever data it carries, a null field carries none, and the
// transport reports the change missed so the inventory reads again. A result without data ends the
// operation.
function watchLiveChanges<TData>(
  client: ApolloClient,
  query: TypedDocumentNode<TData, Record<string, never>>,
  { apply, onStop }: { apply: (data: TData) => void; onStop: (error: ErrorLike) => void },
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
      if (error) onStop(error)
    })
  // A remount that subscribes before this task runs joins the same operation, as useSubscription's
  // does, instead of ending it and starting another.
  return () => {
    stopped = true
    setTimeout(() => subscription.unsubscribe())
  }
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
 * library shows the busy status unless a live change already reported that the run ended. Stop
 * success likewise means the server stored the stop: the returned library shows STOPPING until
 * the run's admitted work finishes.
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

  // Sends a command that answers with the library, and returns the library as the cache now holds
  // it, or null after a refusal.
  async function commandLibrary<TData, TVariables extends OperationVariables>({
    libraryId,
    mutation,
    variables,
    payloadOf,
  }: {
    libraryId: string
    mutation: TypedDocumentNode<TData, TVariables>
    variables: TVariables
    payloadOf: (data: TData | null | undefined) => LibraryOperationPayload | null | undefined
  }): Promise<ManagedLibraryFieldsFragment | null> {
    const outcome = operationOutcome(client.cache, libraryId)
    const { data } = await client.mutate<TData, TVariables>({
      mutation,
      variables,
      fetchPolicy: 'no-cache',
      update: (cache, { data }) => outcome.write(cache, payloadOf(data)),
    })
    await outcome.readInventoryAgainAfterMissedChanges(client)
    return currentLibrary(client.cache, accepted(payloadOf(data)))
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
      execute(() =>
        commandLibrary({
          libraryId,
          mutation: StartLibraryScanDocument,
          variables: { input: { libraryId } },
          payloadOf: (data) => data?.startLibraryScan,
        }),
      ),
    refresh: (libraryId: string, imageRefreshMode: ImageRefreshMode) =>
      execute(() =>
        commandLibrary({
          libraryId,
          mutation: StartLibraryRefreshDocument,
          variables: { input: { libraryId, imageRefreshMode } },
          payloadOf: (data) => data?.startLibraryRefresh,
        }),
      ),
    stopScan: (libraryId: string) =>
      execute(() =>
        commandLibrary({
          libraryId,
          mutation: StopLibraryScanDocument,
          variables: { input: { libraryId } },
          payloadOf: (data) => data?.stopLibraryScan,
        }),
      ),
    stopRefresh: (libraryId: string) =>
      execute(() =>
        commandLibrary({
          libraryId,
          mutation: StopLibraryRefreshDocument,
          variables: { input: { libraryId } },
          payloadOf: (data) => data?.stopLibraryRefresh,
        }),
      ),
    remove: (libraryId: string, onRemoved: () => void) =>
      execute(async () => {
        const outcome = operationOutcome(client.cache, libraryId)
        const { data } = await client.mutate({
          mutation: RemoveLibraryDocument,
          variables: { input: { libraryId } },
          update: (cache, { data }) => outcome.write(cache, data?.removeLibrary),
        })
        await outcome.readInventoryAgainAfterMissedChanges(client)
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

// The cache can hold newer state than the returned library: a live change, or a read after it.
function currentLibrary(
  cache: ApolloCache,
  payload: LibraryOperationPayload | null,
): ManagedLibraryFieldsFragment | null {
  if (!payload) return null
  if (!payload.library) throw new Error('Missing library in the operation result')
  const id = cache.identify(payload.library)
  return cache.readFragment({ fragment: ManagedLibraryFieldsFragmentDoc, id }) ?? payload.library
}

// The returned library, or the status a refusal carries, writes into the cache unless a live
// change for the library arrived during the request: that change can already say the run ended.
// The write happens in the mutation's own cache update, so the library shows its new status by
// the time the command returns.
function operationOutcome(cache: ApolloCache, libraryId: string) {
  const liveChangesBefore = liveChangeCount(cache, libraryId)
  const missedChangesBefore = missedChangeCount(cache)
  return {
    write(target: ApolloCache, payload: LibraryOperationPayload | null | undefined) {
      if (!payload || liveChangeCount(target, libraryId) !== liveChangesBefore) return
      if (payload.library)
        target.writeFragment({ fragment: ManagedLibraryFieldsFragmentDoc, data: payload.library })
      for (const error of payload.userErrors) {
        const status = refusedStatus(error)
        if (status) showStatus(target, libraryId, status)
      }
    },
    // A socket that subscribed during the request may have missed the operation's own change, and
    // the read that followed it may predate the operation. A read after the response cannot.
    async readInventoryAgainAfterMissedChanges(client: ApolloClient) {
      if (missedChangeCount(client.cache) === missedChangesBefore) return
      // A read still in flight can predate the operation, and a refetch now would join it.
      if (isReadingInventory(client)) await readInventory(client)
      await readInventory(client)
    },
  }
}

function isReadingInventory(client: ApolloClient): boolean {
  return [...client.getObservableQueries([AdminLibrariesDocument])].some(
    (query) => query.getCurrentResult().loading,
  )
}

// Silent: a failed read surfaces through the query that ran it.
async function readInventory(client: ApolloClient) {
  await Promise.allSettled(client.refetchQueries({ include: [AdminLibrariesDocument] }).results)
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

// The status a refusal reports for the library, if its member carries one.
function refusedStatus(error: LibraryOperationError): LibraryStatus | null {
  switch (error.__typename) {
    case 'LibraryBusyError':
    case 'LibraryScanNotInProgressError':
    case 'LibraryRefreshNotInProgressError':
      return error.status
    default:
      return null
  }
}

// A refusal names no library, so normalization cannot apply the status it carries.
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
