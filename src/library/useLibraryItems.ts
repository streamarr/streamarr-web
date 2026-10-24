import type { ApolloClient, InMemoryCache } from '@apollo/client'
import { useApolloClient, useQuery } from '@apollo/client/react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  LibraryPageDocument,
  type LibraryPageQuery,
  type LibraryPageQueryVariables,
  type MediaFilter,
  type MediaSort,
} from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'
import { alphabetLetterFromTitle } from '../media/alphabetLetter'
import { trackLibraryItemsConnection } from '../media/watchedState'
import { useLibraryContents } from './LibraryContentsProvider'
import {
  pageSizeAfter,
  pageSizeBefore,
  titlesBeforeLetter,
  titlesFarFromView,
} from './wholeRowPages'

type LibraryWindow = {
  before: number
  after: number
  anchor: string | null
  landingPosition: number
  // The first title left loaded after unloading those before it, its place in the library, and
  // the cursor of the title before it, after which a fresh read of the window begins.
  firstKept?: { cursor: string; position: number; after: string }
}
const windowsByClient = new WeakMap<ApolloClient, Map<string, LibraryWindow>>()

function windowsFor(client: ApolloClient) {
  const existing = windowsByClient.get(client)
  if (existing) return existing
  const windows = new Map<string, LibraryWindow>()
  windowsByClient.set(client, windows)
  const clear = () => {
    windows.clear()
    return Promise.resolve()
  }
  client.onClearStore(clear)
  client.onResetStore(clear)
  return windows
}
type LibraryItems = LibraryPageQuery['library']['items']
type RequestScope = {
  query: string
  active: boolean
  fetchingNext: boolean
  previousRequest: Promise<string | null> | null
  failed: boolean
}
type PageFailure = { query: string; direction: 'next' | 'previous'; error: Error }

export function useLibraryItems({
  libraryId,
  sort,
  filter,
  columns,
}: {
  libraryId: string
  sort: MediaSort
  filter: MediaFilter
  /** The grid's column count; no titles are requested until it is known. */
  columns: number | null
}) {
  const client = useApolloClient()
  const windows = windowsFor(client)
  const contents = useLibraryContents()
  const removed = useSyncExternalStore(
    contents?.subscribe ?? neverChanges,
    () => contents?.isRemoved(libraryId) ?? false,
  )
  const refusal = useSyncExternalStore(contents?.subscribe ?? neverChanges, () =>
    contents?.refusalFor(libraryId),
  )
  const queryKey = JSON.stringify({ libraryId, sort, filter })
  const first = useFirstPageSize(queryKey, columns)
  // Once its first titles are unloaded, a window is read again from its first kept title. The
  // cached window is keyed by sort and filter alone, so the cursor does not split it.
  const readAfter = windows.get(queryKey)?.firstKept?.after
  const { data, previousData, loading, error, refetch } = useQuery(LibraryPageDocument, {
    variables: { libraryId, first, sort, filter, after: readAfter },
    skip: removed || first === null,
  })

  useEffect(
    function trackWatchDependentConnection() {
      if (!data) return
      trackLibraryItemsConnection(client.cache, {
        libraryId,
        args: { sort, filter },
      })
    },
    [client, data, libraryId, sort, filter],
  )
  useLayoutEffect(() => {
    if (first === null) return
    contents?.select({
      variables: { libraryId, first, sort, filter, after: readAfter },
      onItemsChanged(previous, next) {
        const saved = windows.get(queryKey)
        if (!saved) return
        const split = (items: LibraryItems, anchor: string | null) => {
          const edges = definedEdges(items.edges)
          const before = Math.max(
            0,
            edges.findIndex((edge) => edge.cursor === anchor),
          )
          return { before, after: edges.length - before }
        }
        const anchor = findLetterLandingCursor(next.edges, filter.startLetter ?? null, saved.anchor)
        const firstKept = keptThroughChange(saved.firstKept, previous, next)
        const oldSize = split(previous, saved.firstKept?.cursor ?? saved.anchor)
        const newSize = split(next, firstKept?.cursor ?? anchor)
        windows.set(queryKey, {
          ...saved,
          anchor,
          firstKept,
          before: Math.max(0, saved.before + newSize.before - oldSize.before),
          after: Math.max(0, saved.after + newSize.after - oldSize.after),
        })
      },
    })
  }, [contents, windows, queryKey, libraryId, first, sort, filter, readAfter])
  const [currentPageFailure, setPageFailure] = usePageFailure(queryKey)
  // A new query renders its predecessor's page until its own arrives and the screen accepts it,
  // so a letter jump never blanks the grid and the screen can animate the swap. The first result
  // has no predecessor and shows at once.
  const [shownKey, setShownKey] = useState<string | null>(null)
  const staged = !!data && !!previousData && shownKey !== queryKey
  if (data && !previousData && shownKey !== queryKey) {
    setShownKey(queryKey)
  }
  const accept = useCallback(() => setShownKey(queryKey), [queryKey])

  const letter = filter.startLetter ?? null
  const pageInfo = data?.library.items.pageInfo
  const loadedEdges = definedEdges(data?.library.items.edges ?? null)
  const savedWindow = windows.get(queryKey)
  const landingCursor = findLetterLandingCursor(
    data?.library.items.edges,
    letter,
    savedWindow?.anchor,
  )
  const windowAnchor = savedWindow?.firstKept?.cursor ?? landingCursor
  const before = Math.max(
    0,
    loadedEdges.findIndex((edge) => edge.cursor === windowAnchor),
  )
  const after = loadedEdges.length - before
  // The landing title's place in the whole library, counted once per window: rows break on it,
  // and a title added elsewhere in the library must not move the rows already shown.
  const landingPosition =
    savedWindow?.landingPosition ??
    (letter && data
      ? titlesBeforeLetter({
          index: data.library.alphabetIndex,
          letter,
          direction: sort.direction ?? 'ASC',
        })
      : 0)
  const firstPosition = pageInfo?.hasPreviousPage
    ? positionOfFirstLoaded({
        edges: loadedEdges,
        firstKept: savedWindow?.firstKept,
        landingPosition,
        before,
      })
    : 0
  // A letter is shown once the titles before it have loaded, so its row arrives full.
  const [landedKey, setLandedKey] = useState<string | null>(null)
  const holdingLetter =
    landedKey !== queryKey &&
    !!letter &&
    !!pageInfo?.hasPreviousPage &&
    !!pageInfo.startCursor &&
    before === 0 &&
    currentPageFailure?.direction !== 'previous'
  if (data && !holdingLetter && landedKey !== queryKey) {
    setLandedKey(queryKey)
  }
  const restoreBefore = before < (savedWindow?.before ?? 0) && !!pageInfo?.hasPreviousPage
  const restoreAfter = after < (savedWindow?.after ?? 0) && !!pageInfo?.hasNextPage
  const restoringWindow = restoreBefore || restoreAfter
  const [completeResult, setCompleteResult] = useState<{
    key: string
    data: LibraryPageQuery
    firstPosition: number
  } | null>(null)
  if (data && !staged && !holdingLetter && !restoringWindow && completeResult?.data !== data) {
    setCompleteResult({ key: queryKey, data, firstPosition })
  }
  // Keep the committed rows through a staged jump, a held letter, and a late STOPPED refresh.
  // Apollo's previousData can advance again when a seek's backfill arrives before the exit ends.
  const rendered =
    staged || holdingLetter || (restoringWindow && completeResult?.key === queryKey)
      ? (completeResult?.data ?? previousData)
      : (data ?? previousData)
  let renderedFirstPosition = 0
  if (completeResult && rendered === completeResult.data) {
    renderedFirstPosition = completeResult.firstPosition
  }
  if (rendered === data) renderedFirstPosition = firstPosition
  useLayoutEffect(() => {
    if (!data || staged) return
    const saved = windows.get(queryKey)
    windows.set(queryKey, {
      before: Math.max(before, saved?.before ?? 0),
      after: Math.max(after, saved?.after ?? 0),
      anchor: landingCursor,
      landingPosition: saved?.landingPosition ?? landingPosition,
      firstKept: keptAfterReading(saved?.firstKept, definedEdges(data.library.items.edges)),
    })
  }, [windows, queryKey, data, staged, before, after, landingCursor, landingPosition])
  // Each committed query owns its in-flight pages; a result from an earlier view is discarded.
  const scopeRef = useRef<RequestScope | null>(null)
  useLayoutEffect(
    function activateCommittedQuery() {
      const scope: RequestScope = {
        query: queryKey,
        active: true,
        fetchingNext: false,
        previousRequest: null,
        failed: false,
      }
      scopeRef.current = scope
      return () => {
        scope.active = false
      }
    },
    [queryKey],
  )
  function committedScope() {
    const scope = scopeRef.current
    return scope?.query === queryKey && scope.active && !scope.failed ? scope : null
  }

  function failPage(scope: RequestScope, direction: PageFailure['direction'], error: unknown) {
    if (!scope.active) return
    scope.failed = true
    setPageFailure({
      query: scope.query,
      direction,
      error: error instanceof Error ? error : new Error('Could not load this page.'),
    })
  }

  // Apollo suppresses cache notifications during fetchMore. Read beside the watched query so
  // subscription payloads still render while a continuation is in flight.
  async function readPage({
    variables,
    update,
  }: {
    variables: LibraryPageQueryVariables
    update: (previous: LibraryPageQuery, page: LibraryPageQuery) => LibraryPageQuery
  }) {
    const { data: page } = await client.query({
      query: LibraryPageDocument,
      variables,
      fetchPolicy: 'no-cache',
    })
    if (!page) return undefined
    client.cache.updateQuery(
      { query: LibraryPageDocument, variables: { libraryId, first, sort, filter } },
      (previous) => (previous ? update(previous, page) : undefined),
    )
    return page
  }

  function loadMore() {
    const scope = committedScope()
    if (!scope || columns === null || !pageInfo?.hasNextPage || scope.fetchingNext) {
      return
    }
    scope.fetchingNext = true
    void readPage({
      variables: {
        libraryId,
        first: pageSizeAfter({ columns, end: firstPosition + loadedEdges.length }),
        after: pageInfo.endCursor,
        last: undefined,
        before: undefined,
        sort,
        filter,
      },
      update: (previous, page) =>
        !scope.active || previous.library.items.pageInfo.endCursor !== pageInfo.endCursor
          ? previous
          : {
              library: {
                ...page.library,
                items: appendItemsPage(previous.library.items, page.library.items),
              },
            },
    })
      .catch((error: unknown) => failPage(scope, 'next', error))
      .finally(() => {
        scope.fetchingNext = false
      })
  }

  function loadPrevious() {
    const scope = committedScope()
    if (!scope) return
    if (scope.previousRequest) return scope.previousRequest
    if (columns === null || !pageInfo?.hasPreviousPage || !pageInfo.startCursor) {
      return
    }
    // A `before` cursor replaces the letter seek anchor (ADR 0023).
    const { startLetter: _startLetter, ...continuationFilter } = filter
    scope.previousRequest = readPage({
      variables: {
        libraryId,
        first: undefined,
        after: undefined,
        last: pageSizeBefore({ columns, start: firstPosition }),
        before: pageInfo.startCursor,
        sort,
        filter: continuationFilter,
      },
      update: (previous, page) =>
        !scope.active || previous.library.items.pageInfo.startCursor !== pageInfo.startCursor
          ? previous
          : {
              library: {
                ...page.library,
                items: prependItemsPage(previous.library.items, page.library.items),
              },
            },
    })
      .then((page) => page?.library.items.pageInfo.startCursor ?? null)
      .catch((error: unknown) => {
        failPage(scope, 'previous', error)
        return null
      })
      .finally(() => {
        scope.previousRequest = null
      })
    return scope.previousRequest
  }

  // Invalidated watch metadata must not collapse a previously expanded window to one page.
  // Remember both sides of the seek anchor, since preceding pages contribute to scroll offsets.
  const restoreWindow = useEffectEvent(() => {
    if (restoreBefore) void loadPrevious()
    if (restoreAfter) loadMore()
  })
  useEffect(() => {
    if (!loading) restoreWindow()
  }, [loading, queryKey, before, after, restoreBefore, restoreAfter])

  // A letter's page is followed once by the page before it, so the viewer can scroll up across
  // the letter boundary without a gap. A window kept from an earlier visit already has it.
  const backfilledQueryRef = useRef<string | null>(null)
  const loadPageBehindTheLetter = useEffectEvent(() => {
    void loadPrevious()
  })
  useEffect(
    function loadPageBehindTheLetterOnce() {
      if (!letter || !data || backfilledQueryRef.current === queryKey) {
        return
      }
      backfilledQueryRef.current = queryKey
      if (before === 0) loadPageBehindTheLetter()
    },
    [letter, data, queryKey, before],
  )

  // Where a query's own result belongs once it renders: its letter's first title, or the top.
  // Later pages merge into the same result without moving it.
  const landing =
    data && !staged && !holdingLetter && !restoringWindow
      ? { key: queryKey, cursor: landingCursor }
      : null

  // Titles far from the view leave the cache, so a long scroll holds about as many titles as a
  // short one. The window reopens on that side, and its pages load again when scrolled back to.
  function unloadFarFrom(view: { first: number; last: number }) {
    if (columns === null || !data || landing === null) return
    const far = titlesFarFromView({ columns, firstPosition, count: loadedEdges.length, ...view })
    if (far.before === 0 && far.after === 0) return
    const kept = loadedEdges.slice(far.before, loadedEdges.length - far.after)
    const saved = windows.get(queryKey)
    const anchor = findLetterLandingCursor(kept, letter, saved?.anchor)
    const firstKept =
      far.before > 0
        ? {
            cursor: kept[0].cursor,
            position: firstPosition + far.before,
            after: loadedEdges[far.before - 1].cursor,
          }
        : saved?.firstKept
    const keptBefore = Math.max(
      0,
      kept.findIndex((edge) => edge.cursor === (firstKept?.cursor ?? anchor)),
    )
    windows.set(queryKey, {
      anchor,
      before: keptBefore,
      after: kept.length - keptBefore,
      landingPosition: saved?.landingPosition ?? landingPosition,
      firstKept,
    })
    client.cache.updateQuery(
      { query: LibraryPageDocument, variables: { libraryId, first, sort, filter } },
      (previous) =>
        previous && {
          library: {
            ...previous.library,
            items: keepItems(previous.library.items, {
              from: far.before > 0 ? kept[0].cursor : null,
              through: far.after > 0 ? (kept.at(-1)?.cursor ?? null) : null,
            }),
          },
        },
    )
    // Apollo keeps every result it has read, and its record of their identities has no limit;
    // only a reset lets the unloaded titles' results go.
    const cache = client.cache as InMemoryCache
    cache.gc({ resetResultCache: true })
  }

  return {
    removed,
    loading:
      !removed &&
      refusal === undefined &&
      (loading || first === null || holdingLetter) &&
      !rendered,
    pending: (loading && !data && !!previousData) || staged || (holdingLetter && !!rendered),
    staged,
    accept,
    error: refusal ?? error ?? currentPageFailure?.error,
    library: removed || refusal !== undefined ? null : (rendered?.library ?? null),
    edges: definedEdges(rendered?.library.items.edges ?? null),
    hasNextPage: rendered?.library.items.pageInfo.hasNextPage ?? false,
    hasPreviousPage: rendered?.library.items.pageInfo.hasPreviousPage ?? false,
    /** The library position of the first title in `edges`; the grid's rows break on it. */
    firstPosition: renderedFirstPosition,
    loadMore,
    loadPrevious,
    unloadFarFrom,
    retry: () => {
      if (refusal !== undefined) {
        void contents?.retry(libraryId, refetch).catch(() => undefined)
        return
      }
      if (currentPageFailure && scopeRef.current?.query === queryKey) {
        scopeRef.current.failed = false
        setPageFailure(null)
        if (currentPageFailure.direction === 'previous') {
          void loadPrevious()
          return
        }
        loadMore()
        return
      }
      // The outcome arrives through `error` and `data`; the promise only duplicates it.
      void refetch().catch(() => undefined)
    },
    landing,
  }
}

function findLetterLandingCursor(
  edges: LibraryItems['edges'] | undefined,
  letter: string | null,
  previousAnchor: string | null | undefined,
) {
  if (!letter) return null
  const resolvedEdges = definedEdges(edges)
  const landingEdge = resolvedEdges.find(
    (edge) => alphabetLetterFromTitle(edge.node.titleSort ?? edge.node.title ?? '') === letter,
  )
  const fallback = resolvedEdges.find((edge) => edge.cursor === previousAnchor) ?? resolvedEdges[0]
  return (landingEdge ?? fallback)?.cursor ?? null
}

function positionOfFirstLoaded({
  edges,
  firstKept,
  landingPosition,
  before,
}: {
  edges: ReadonlyArray<{ cursor: string }>
  firstKept: LibraryWindow['firstKept']
  landingPosition: number
  before: number
}) {
  if (!firstKept) return Math.max(0, landingPosition - before)
  // A window read again without its first kept title begins at the title that took its place.
  const keptIndex = Math.max(
    0,
    edges.findIndex((edge) => edge.cursor === firstKept.cursor),
  )
  return Math.max(0, firstKept.position - keptIndex)
}

// A window read again after its first kept title left the library begins with the title that
// followed it, which now holds its place.
function keptAfterReading(
  firstKept: LibraryWindow['firstKept'],
  edges: ReadonlyArray<{ cursor: string }>,
): LibraryWindow['firstKept'] {
  if (!firstKept || edges.length === 0) return firstKept
  if (edges.some((edge) => edge.cursor === firstKept.cursor)) return firstKept
  return { ...firstKept, cursor: edges[0].cursor }
}

// A live removal of the first kept title passes its place to the next title still loaded.
function keptThroughChange(
  firstKept: LibraryWindow['firstKept'],
  previous: LibraryItems,
  next: LibraryItems,
): LibraryWindow['firstKept'] {
  if (!firstKept) return firstKept
  const nextEdges = definedEdges(next.edges)
  const nextCursors = new Set(nextEdges.map((edge) => edge.cursor))
  if (nextCursors.has(firstKept.cursor)) return firstKept
  const previousEdges = definedEdges(previous.edges)
  const removedAt = previousEdges.findIndex((edge) => edge.cursor === firstKept.cursor)
  const successor = previousEdges.slice(removedAt + 1).find((edge) => nextCursors.has(edge.cursor))
  if (!successor) return firstKept
  const index = nextEdges.findIndex((edge) => edge.cursor === successor.cursor)
  return {
    cursor: successor.cursor,
    position: firstKept.position,
    after: index > 0 ? nextEdges[index - 1].cursor : firstKept.after,
  }
}

// The loaded titles from one cursor through another; null keeps that end as it is.
function keepItems(
  loaded: LibraryItems,
  { from, through }: { from: string | null; through: string | null },
): LibraryItems {
  const edges = loaded.edges ?? []
  const start = from === null ? 0 : edges.findIndex((edge) => edge?.cursor === from)
  const end =
    through === null ? edges.length - 1 : edges.findIndex((edge) => edge?.cursor === through)
  if (start < 0 || end < 0) return loaded
  return {
    ...loaded,
    edges: edges.slice(start, end + 1),
    pageInfo: {
      ...loaded.pageInfo,
      ...(from !== null && { hasPreviousPage: true, startCursor: from }),
      ...(through !== null && { hasNextPage: true, endCursor: through }),
    },
  }
}

function appendItemsPage(loaded: LibraryItems, next: LibraryItems): LibraryItems {
  return {
    ...loaded,
    edges: [...(loaded.edges ?? []), ...withoutLoadedItems(next.edges, loaded.edges)],
    pageInfo: {
      ...loaded.pageInfo,
      hasNextPage: next.pageInfo.hasNextPage,
      endCursor: next.pageInfo.endCursor,
    },
  }
}

function prependItemsPage(loaded: LibraryItems, previous: LibraryItems): LibraryItems {
  return {
    ...loaded,
    edges: [...withoutLoadedItems(previous.edges, loaded.edges), ...(loaded.edges ?? [])],
    pageInfo: {
      ...loaded.pageInfo,
      hasPreviousPage: previous.pageInfo.hasPreviousPage,
      startCursor: previous.pageInfo.startCursor,
    },
  }
}

// A watch-state change can move an item, so a page can bring back an item already loaded.
function withoutLoadedItems(page: LibraryItems['edges'], loaded: LibraryItems['edges']) {
  const loadedIds = new Set(definedEdges(loaded).map((edge) => edge.node.id))
  return (page ?? []).filter((edge) => !edge?.node || !loadedIds.has(edge.node.id))
}

function neverChanges() {
  return () => {}
}

// The first page of a query is sized once, so a later change of column count reads the same
// cached window rather than asking again.
function useFirstPageSize(queryKey: string, columns: number | null) {
  const [request, setRequest] = useState<{ query: string; first: number } | null>(null)
  if (columns !== null && request?.query !== queryKey) {
    const next = { query: queryKey, first: pageSizeAfter({ columns, end: 0 }) }
    setRequest(next)
    return next.first
  }
  return request?.query === queryKey ? request.first : null
}

function usePageFailure(queryKey: string) {
  const [pageFailure, setPageFailure] = useState<PageFailure | null>(null)
  if (pageFailure && pageFailure.query !== queryKey) {
    setPageFailure(null)
    return [null, setPageFailure] as const
  }
  return [pageFailure, setPageFailure] as const
}
