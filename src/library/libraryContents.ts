import { CombinedGraphQLErrors } from '@apollo/client/errors'
import type { ApolloClient, OperationVariables, TypedDocumentNode } from '@apollo/client'
import {
  LibraryCountsChangedDocument,
  LibraryItemAddedDocument,
  LibraryItemRemovedDocument,
  LibraryItemUpdatedDocument,
  LibraryPageDocument,
  MediaSummaryFieldsFragmentDoc,
  type LibraryItemChangeFieldsFragment,
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
    const key = JSON.stringify(view.variables)
    if (active?.key === key || removed.has(view.variables.libraryId)) return
    release(true)
    const libraryId = view.variables.libraryId
    const scope: NonNullable<typeof active> = {
      key,
      variables: view.variables,
      stop: () => {},
      restart: () => select(view),
      refusal: undefined,
    }
    active = scope
    scope.stop = subscribeToLibraryContents({
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
    args: { first: variables.first ?? 48, sort: sort ?? {}, filter: filter ?? {} },
  })

  function stop() {
    if (stopped) return
    stopped = true
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

  function changeItems(update: (items: Items) => Items) {
    client.cache.updateQuery({ query: LibraryPageDocument, variables }, (data) => {
      if (!data) return undefined
      const previous = data.library.items
      expandBounds(bounds, previous)
      const next = update(previous)
      onItemsChanged(previous, next)
      return { ...data, library: { ...data.library, items: next } }
    })
  }

  function applyChange(change: LibraryItemChangeFieldsFragment | null | undefined) {
    if (change?.libraryId !== libraryId) return
    client.cache.batch({
      update(cache) {
        const item = change.item
        if (item?.__typename === 'Movie' || item?.__typename === 'Series') {
          cache.writeFragment({
            fragment: MediaSummaryFieldsFragmentDoc,
            fragmentName: 'MediaSummaryFields',
            data: item,
          })
        }
        changeItems((items) => placeItem(items, change, bounds))
      },
    })
  }

  subscriptions.push(
    client.watchQuery({ query: LibraryPageDocument, variables }).subscribe({
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
    client.cache.batch({
      update(cache) {
        changeItems((items) => removeItem(items, change.itemId))
        const typename = change.kind === 'MOVIE' ? 'Movie' : 'Series'
        cache.evict({ id: cache.identify({ __typename: typename, id: change.itemId }) })
      },
    })
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
  return stop
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

function removeItem(items: Items, id: string): Items {
  return withEdges(
    items,
    definedEdges(items.edges).filter((edge) => edge.node.id !== id),
  )
}

function placeItem(items: Items, change: LibraryItemChangeFieldsFragment, bounds: Bounds): Items {
  const others = definedEdges(items.edges).filter((edge) => edge.node.id !== change.itemId)
  const { edge } = change
  if (edge === null) return withEdges(items, others)
  if (!edge?.node) return items
  if (edge.node.__typename !== 'Movie' && edge.node.__typename !== 'Series') return items
  const { orderKey, node } = edge
  const { hasPreviousPage, hasNextPage } = items.pageInfo
  const beforeWindow = hasPreviousPage && (bounds.first === null || orderKey < bounds.first)
  const afterWindow = hasNextPage && (bounds.last === null || orderKey > bounds.last)
  if (beforeWindow || afterWindow) return withEdges(items, others)
  const index = others.findIndex((edge) => edge.orderKey > orderKey)
  return withEdges(items, others.toSpliced(index < 0 ? others.length : index, 0, { ...edge, node }))
}

function withEdges(items: Items, edges: Items['edges']): Items {
  const resolved = definedEdges(edges)
  return {
    ...items,
    edges,
    pageInfo: {
      ...items.pageInfo,
      // A partial window can become empty. Its last server cursors still anchor continuation.
      startCursor: items.pageInfo.hasPreviousPage
        ? items.pageInfo.startCursor
        : (resolved[0]?.cursor ?? items.pageInfo.startCursor),
      endCursor: items.pageInfo.hasNextPage
        ? items.pageInfo.endCursor
        : (resolved.at(-1)?.cursor ?? items.pageInfo.endCursor),
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
