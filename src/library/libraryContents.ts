import { CombinedGraphQLErrors } from '@apollo/client/errors'
import type {
  ApolloCache,
  ApolloClient,
  InMemoryCache,
  OperationVariables,
  Reference,
  StoreObject,
  TypedDocumentNode,
} from '@apollo/client'
import {
  LibraryCountsChangedDocument,
  LibraryItemAddedDocument,
  LibraryItemRemovedDocument,
  LibraryItemUpdatedDocument,
  LibraryPageDocument,
  MediaSummaryFieldsFragmentDoc,
  type LibraryItemChangeFieldsFragment,
  type MediaType,
  type LibraryPageQuery,
  type LibraryPageQueryVariables,
} from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'
import { responsePathHasError } from '../graphql/responseErrors'
import { retainLibraryItemsConnection } from '../media/watchedState'

type Items = LibraryPageQuery['library']['items']
type View = {
  variables: LibraryPageQueryVariables & { libraryId: string }
  onItemsChanged: (previous: Items, next: Items) => void
}
type Bounds = {
  first: string | null
  last: string | null
  startCursor?: string | null
  endCursor?: string | null
}

/** Owns one library view through its detail routes. Query recovery uses the retained observer. */
export function createLibraryContents({ client }: { client: ApolloClient }) {
  let active: {
    key: string
    variables: View['variables']
    stop: () => void
    follow: (variables: View['variables']) => void
    restart: () => void
    refusal: unknown
  } | null = null
  const removed = new Set<string>()
  const listeners = new Set<() => void>()

  function release(evict = false) {
    const previous = active
    active = null
    previous?.stop()
    if (evict && previous) {
      const { libraryId, ...args } = previous.variables
      client.cache.evict({
        id: client.cache.identify({ __typename: 'Library', id: libraryId }),
        fieldName: 'items',
        args,
        // Apollo detaches the closing screen's observer on a later tick.
        broadcast: false,
      })
    }
  }

  function select(view: View) {
    const { libraryId, sort, filter } = view.variables
    const key = JSON.stringify({ libraryId, sort, filter })
    if (active?.key === key) {
      active.variables = view.variables
      active.follow(view.variables)
      return
    }
    if (removed.has(view.variables.libraryId)) return
    release(true)
    const scope: NonNullable<typeof active> = {
      key,
      variables: view.variables,
      stop: () => {},
      follow: () => {},
      restart: () => select(view),
      refusal: undefined,
    }
    active = scope
    const subscription = subscribeToLibraryContents({
      client,
      view,
      onRefused: (error) => {
        if (active !== scope) return
        scope.refusal = error
        scope.stop()
        for (const listener of listeners) listener()
      },
      onRemoved: () => {
        if (active !== scope) return
        removed.add(libraryId)
        release()
        for (const listener of listeners) listener()
      },
    })
    scope.stop = subscription.stop
    scope.follow = subscription.follow
    if (active !== scope || scope.refusal !== undefined) scope.stop()
  }

  return {
    select,
    leaveUnlessWithin(pathname: string) {
      if (!active) return
      if (
        pathname === `/library/${active.variables.libraryId}` ||
        /^\/(movie|series|season)\//.test(pathname)
      )
        return
      release(true)
    },
    isRemoved: (libraryId: string) => removed.has(libraryId),
    refusalFor: (libraryId: string) =>
      active?.variables.libraryId === libraryId ? active.refusal : undefined,
    async retry(libraryId: string, read: () => Promise<unknown>) {
      const scope = active
      if (scope?.variables.libraryId !== libraryId || scope.refusal === undefined) return
      await read()
      if (active !== scope) return
      const restart = scope.restart
      release()
      restart()
      for (const listener of listeners) listener()
    },
    subscribe(this: void, listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: release,
  }
}

function subscribeToLibraryContents({
  client,
  view,
  onRemoved,
  onRefused,
}: {
  client: ApolloClient
  view: View
  onRemoved: () => void
  onRefused: (error: unknown) => void
}) {
  const { variables, onItemsChanged } = view
  const { libraryId, sort, filter } = variables
  let stopped = false
  const subscriptions: { unsubscribe: () => void }[] = []
  const bounds: Bounds = { first: null, last: null }
  const releaseConnection = retainLibraryItemsConnection(client.cache, {
    libraryId,
    args: { sort: sort ?? {}, filter: filter ?? {} },
  })

  function stop() {
    if (stopped) return
    stopped = true
    clearTimeout(applyTimer)
    for (const subscription of subscriptions) subscription.unsubscribe()
    releaseConnection()
  }

  function listen<TData, TVariables extends OperationVariables>(
    query: TypedDocumentNode<TData, TVariables>,
    args: TVariables,
    apply: (data: TData) => void,
  ) {
    if (stopped) return
    let refusal: unknown
    subscriptions.push(
      client
        .subscribe({ query, variables: args, fetchPolicy: 'no-cache', errorPolicy: 'all' })
        .subscribe({
          next: ({ data, error }) => {
            if (error && (data == null || isTerminalRefusal(error))) refusal = error
            // A failed edge or item is not a removal. Shared recovery reads incomplete changes again.
            if (!stopped && data && !responsePathHasError(error, ['change'])) apply(data)
          },
          error: (error: unknown) => {
            if (!stopped) onRefused(error)
          },
          complete: () => {
            if (stopped) return
            if (refusal !== undefined) {
              onRefused(refusal)
              return
            }
            onRemoved()
          },
        }),
    )
  }

  // A list write costs time, and an entry in Apollo's read caches, in proportion to the loaded
  // titles. Changes queue, and a list is written again only after an interval that grows with
  // its length, so a scan's writes cost about the same each second however large the list is.
  const pending: LiveChange[] = []
  let applyTimer: ReturnType<typeof setTimeout> | undefined
  let appliedAt = -Infinity
  let loadedTitles = 0

  function enqueue(change: LiveChange) {
    pending.push(change)
    const interval = Math.min(MAX_LIST_WRITE_INTERVAL_MS, loadedTitles * LIST_WRITE_MS_PER_TITLE)
    applyTimer ??= setTimeout(applyPending, Math.max(0, appliedAt + interval - Date.now()))
  }

  function applyPending() {
    applyTimer = undefined
    appliedAt = Date.now()
    const changes = pending.splice(0)
    if (stopped) return
    client.cache.batch({
      update(cache) {
        for (const change of changes) normalizeItem(cache, change)
        placeEdges(cache, changes)
        for (const id of finallyRemoved(changes)) cache.evict({ id })
      },
    })
  }

  function placeEdges(cache: ApolloCache, changes: readonly LiveChange[]) {
    const previous = cache.readQuery({ query: LibraryPageDocument, variables })
    if (!previous) return
    expandBounds(bounds, previous.library.items)
    // cache.modify cannot target one argument variant of a field (apollo-client#7129).
    const itemsField = (cache as InMemoryCache).policies.getStoreFieldName({
      typename: 'Library',
      fieldName: 'items',
      args: { first: variables.first, sort, filter },
    })
    cache.modify<{ items: StoredItems }>({
      id: cache.identify({ __typename: 'Library', id: libraryId }),
      fields: {
        items(stored, { storeFieldName, isReference, toReference }) {
          if (storeFieldName !== itemsField || isReference(stored)) return stored
          return changes.reduce(
            (items, change) => placeEdge(items, change, bounds, toReference),
            stored,
          )
        },
      },
    })
    const next = cache.readQuery({ query: LibraryPageDocument, variables })
    if (!next) return
    loadedTitles = next.library.items.edges?.length ?? 0
    onItemsChanged(previous.library.items, next.library.items)
  }

  function entityOf(itemId: string, kind: MediaType) {
    return client.cache.identify({ __typename: kind === 'MOVIE' ? 'Movie' : 'Series', id: itemId })
  }

  function applyChange(change: LibraryItemChangeFieldsFragment | null | undefined) {
    if (change?.libraryId !== libraryId) return
    const entity = entityOf(change.itemId, change.kind)
    if (entity) enqueue({ at: 'changed', entity, change })
  }

  // Retained through detail routes, so a read of the active queries after missed changes reads
  // this window again too. It follows the screen's variables, so both read from the same title.
  const windowQuery = client.watchQuery({ query: LibraryPageDocument, variables })
  subscriptions.push(
    windowQuery.subscribe({
      next: (result) => {
        if (!stopped && result.dataState === 'complete')
          expandBounds(bounds, result.data.library.items)
      },
      error: () => {},
    }),
  )
  listen(LibraryItemAddedDocument, { libraryId, sort, filter }, ({ change }) => applyChange(change))
  listen(LibraryItemUpdatedDocument, { libraryId, sort, filter }, ({ change }) =>
    applyChange(change),
  )
  listen(LibraryItemRemovedDocument, { libraryId }, ({ change }) => {
    if (change?.libraryId !== libraryId) return
    if (change.kind !== 'MOVIE' && change.kind !== 'SERIES') return
    const entity = entityOf(change.itemId, change.kind)
    if (entity) enqueue({ at: 'removed', entity })
  })
  listen(LibraryCountsChangedDocument, { libraryId }, (data) => {
    if (data.change?.id !== libraryId) return
    client.cache.writeQuery({
      query: LibraryCountsChangedDocument,
      id: 'ROOT_SUBSCRIPTION',
      variables: { libraryId },
      data,
    })
  })
  return {
    stop,
    follow: (next: View['variables']) => {
      if (!stopped) void windowQuery.setVariables(next)
    },
  }
}

function expandBounds(bounds: Bounds, items: Items) {
  const startCursor = items.pageInfo.hasPreviousPage ? items.pageInfo.startCursor : null
  const endCursor = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null
  // Server anchors change on recovery and continuation, but survive live removals.
  if (bounds.startCursor !== startCursor) bounds.first = null
  if (bounds.endCursor !== endCursor) bounds.last = null
  bounds.startCursor = startCursor
  bounds.endCursor = endCursor
  const edges = definedEdges(items.edges)
  for (const edge of edges) {
    if (bounds.first === null || edge.orderKey < bounds.first) bounds.first = edge.orderKey
    if (bounds.last === null || edge.orderKey > bounds.last) bounds.last = edge.orderKey
  }
}

const LIST_WRITE_MS_PER_TITLE = 0.5
const MAX_LIST_WRITE_INTERVAL_MS = 1000

type LiveChange =
  | { at: 'changed'; entity: string; change: LibraryItemChangeFieldsFragment }
  | { at: 'removed'; entity: string }
// Stored edges are embedded objects whose nodes are references to normalized items.
type StoredEdge = {
  __typename: 'MediaEdge'
  cursor: string
  orderKey: string
  node: Reference | null
}
type StoredItems = Omit<Items, 'edges'> & { edges: (StoredEdge | null)[] }

function normalizeItem(cache: ApolloCache, change: LiveChange) {
  if (change.at !== 'changed') return
  const item = change.change.item ?? change.change.edge?.node
  if (item?.__typename !== 'Movie' && item?.__typename !== 'Series') return
  cache.writeFragment({
    fragment: MediaSummaryFieldsFragmentDoc,
    fragmentName: 'MediaSummaryFields',
    data: item,
  })
}

// A null edge only leaves this view, so only a removal event evicts the item itself.
function finallyRemoved(changes: readonly LiveChange[]) {
  const removed = new Map<string, boolean>()
  for (const change of changes) removed.set(change.entity, change.at === 'removed')
  return [...removed].filter(([, isRemoved]) => isRemoved).map(([entity]) => entity)
}

function placeEdge(
  items: StoredItems,
  change: LiveChange,
  bounds: Bounds,
  toReference: (item: StoreObject) => Reference | undefined,
): StoredItems {
  if (change.at === 'removed') return withoutEntity(items, change.entity)
  const { edge } = change.change
  if (edge === null) return withoutEntity(items, change.entity)
  const node = edge?.node
  if (node?.__typename !== 'Movie' && node?.__typename !== 'Series') return items
  const { orderKey, cursor } = edge
  const { hasPreviousPage, hasNextPage } = items.pageInfo
  const beforeWindow = hasPreviousPage && (bounds.first === null || orderKey < bounds.first)
  const afterWindow = hasNextPage && (bounds.last === null || orderKey > bounds.last)
  if (beforeWindow || afterWindow) return withoutEntity(items, change.entity)
  const current = items.edges.find((stored) => stored?.node?.__ref === change.entity)
  if (current?.cursor === cursor && current.orderKey === orderKey) return items
  const reference = toReference(node)
  if (!reference) return items
  const others = withoutEntity(items, change.entity).edges
  const index = others.findIndex((other) => other !== null && other.orderKey > orderKey)
  const placed: StoredEdge = { __typename: 'MediaEdge', cursor, orderKey, node: reference }
  return withEdges(items, others.toSpliced(index < 0 ? others.length : index, 0, placed))
}

function withoutEntity(items: StoredItems, entity: string) {
  const index = items.edges.findIndex((stored) => stored?.node?.__ref === entity)
  return index < 0 ? items : withEdges(items, items.edges.toSpliced(index, 1))
}

function withEdges(items: StoredItems, edges: StoredItems['edges']): StoredItems {
  const placed = edges.filter((edge) => edge?.node)
  return {
    ...items,
    edges,
    pageInfo: {
      ...items.pageInfo,
      // A partial window can become empty. Its last server cursors still anchor continuation.
      startCursor: items.pageInfo.hasPreviousPage
        ? items.pageInfo.startCursor
        : (placed[0]?.cursor ?? items.pageInfo.startCursor),
      endCursor: items.pageInfo.hasNextPage
        ? items.pageInfo.endCursor
        : (placed.at(-1)?.cursor ?? items.pageInfo.endCursor),
    },
  }
}

function isTerminalRefusal(error: unknown) {
  return (
    CombinedGraphQLErrors.is(error) &&
    error.errors.some(
      (entry) =>
        (entry.extensions?.code === 'FORBIDDEN' || entry.extensions?.code === 'PROFILE_REQUIRED') &&
        (entry.path?.length ?? 0) <= 1,
    )
  )
}
