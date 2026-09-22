import { useQuery } from '@apollo/client/react'
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import {
  LibraryPageDocument,
  type LibraryPageQuery,
  type MediaFilter,
  type MediaSort,
} from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'
import { alphabetLetterFromTitle } from '../media/alphabetLetter'

const PAGE_SIZE = 48
type LibraryItems = LibraryPageQuery['library']['items']
type RequestScope = {
  query: string
  active: boolean
  fetchingNext: boolean
  previousRequest: Promise<string | null> | null
}

export function useLibraryItems({
  libraryId,
  sort,
  filter,
}: {
  libraryId: string
  sort: MediaSort
  filter: MediaFilter
}) {
  const { data, previousData, loading, error, fetchMore, refetch } = useQuery(LibraryPageDocument, {
    variables: { libraryId, first: PAGE_SIZE, sort, filter },
  })

  const queryKey = JSON.stringify({ libraryId, sort, filter })
  // A new query renders its predecessor's page until its own arrives and the screen accepts it,
  // so a letter jump never blanks the grid and the screen can animate the swap. The first result
  // has no predecessor and shows at once.
  const [shownKey, setShownKey] = useState<string | null>(null)
  const staged = !!data && !!previousData && shownKey !== queryKey
  if (data && !previousData && shownKey !== queryKey) {
    setShownKey(queryKey)
  }
  const accept = useCallback(() => setShownKey(queryKey), [queryKey])
  const rendered = staged ? previousData : (data ?? previousData)

  const letter = filter.startLetter ?? null
  const pageInfo = data?.library.items.pageInfo
  // Each committed query owns its in-flight pages. Apollo applies updateQuery to the current
  // variables, so a response from an earlier query must not write into the new result.
  const scopeRef = useRef<RequestScope | null>(null)
  useLayoutEffect(
    function activateCommittedQuery() {
      const scope: RequestScope = {
        query: queryKey,
        active: true,
        fetchingNext: false,
        previousRequest: null,
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
    return scope?.query === queryKey && scope.active ? scope : null
  }

  function loadMore() {
    const scope = committedScope()
    if (!scope || !pageInfo?.hasNextPage || scope.fetchingNext) {
      return
    }
    scope.fetchingNext = true
    void fetchMore({
      // fetchMore merges onto the current variables — last/before must be cleared explicitly.
      variables: {
        libraryId,
        first: PAGE_SIZE,
        after: pageInfo.endCursor,
        last: undefined,
        before: undefined,
        sort,
        filter,
      },
      updateQuery: (previous, { fetchMoreResult }) =>
        !scope.active || previous.library.items.pageInfo.endCursor !== pageInfo.endCursor
          ? previous
          : {
              library: {
                ...fetchMoreResult.library,
                items: appendItemsPage(previous.library.items, fetchMoreResult.library.items),
              },
            },
    }).finally(() => {
      scope.fetchingNext = false
    })
  }

  function loadPrevious() {
    const scope = committedScope()
    if (!scope) return
    if (scope.previousRequest) return scope.previousRequest
    if (!pageInfo?.hasPreviousPage || !pageInfo.startCursor) {
      return
    }
    // A `before` cursor replaces the letter seek anchor (ADR 0023).
    const { startLetter: _startLetter, ...continuationFilter } = filter
    scope.previousRequest = fetchMore({
      variables: {
        libraryId,
        first: undefined,
        after: undefined,
        last: PAGE_SIZE,
        before: pageInfo.startCursor,
        sort,
        filter: continuationFilter,
      },
      updateQuery: (previous, { fetchMoreResult }) =>
        !scope.active || previous.library.items.pageInfo.startCursor !== pageInfo.startCursor
          ? previous
          : {
              library: {
                ...fetchMoreResult.library,
                items: prependItemsPage(previous.library.items, fetchMoreResult.library.items),
              },
            },
    })
      .then((result) => result.data?.library.items.pageInfo.startCursor ?? null)
      .finally(() => {
        scope.previousRequest = null
      })
    return scope.previousRequest
  }

  // A letter's page is followed once by the page before it, so the viewer can scroll up across
  // the letter boundary without a gap.
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
      loadPageBehindTheLetter()
    },
    [letter, data, queryKey],
  )

  // Where a query's own result belongs once it renders: its letter's first title, or the top.
  // Later pages merge into the same result without moving it.
  const landing =
    data && !staged
      ? { key: queryKey, cursor: findLetterLandingCursor(data.library.items.edges, letter) }
      : null

  return {
    loading: loading && !rendered,
    pending: (loading && !data && !!previousData) || staged,
    staged,
    accept,
    error,
    library: rendered?.library ?? null,
    edges: definedEdges(rendered?.library.items.edges ?? null),
    hasNextPage: rendered?.library.items.pageInfo.hasNextPage ?? false,
    hasPreviousPage: rendered?.library.items.pageInfo.hasPreviousPage ?? false,
    loadMore,
    loadPrevious,
    // The outcome arrives through `error` and `data`; the promise only duplicates it.
    retry: () => void refetch().catch(() => undefined),
    landing,
  }
}

function findLetterLandingCursor(edges: LibraryItems['edges'] | undefined, letter: string | null) {
  if (!letter) return null
  const resolvedEdges = definedEdges(edges)
  const landingEdge = resolvedEdges.find(
    (edge) => alphabetLetterFromTitle(edge.node.titleSort ?? edge.node.title ?? '') === letter,
  )
  return (landingEdge ?? resolvedEdges[0])?.cursor ?? null
}

function appendItemsPage(loaded: LibraryItems, next: LibraryItems): LibraryItems {
  return {
    ...loaded,
    edges: [...(loaded.edges ?? []), ...(next.edges ?? [])],
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
    edges: [...(previous.edges ?? []), ...(loaded.edges ?? [])],
    pageInfo: {
      ...loaded.pageInfo,
      hasPreviousPage: previous.pageInfo.hasPreviousPage,
      startCursor: previous.pageInfo.startCursor,
    },
  }
}
