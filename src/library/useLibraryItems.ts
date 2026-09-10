import { useQuery } from '@apollo/client/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LibraryPageDocument, type MediaFilter, type MediaSort } from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'
import { alphabetLetterFromTitle } from '../media/alphabetLetter'

const PAGE_SIZE = 48

// Filter/sort/letter are props, so a plain change is a normal Apollo variables change: edges
// accumulated by loadMore/loadPrevious are dropped automatically, no bespoke reset needed.
export function useLibraryItems({
  libraryId,
  sort,
  filter,
}: {
  libraryId: string
  sort: MediaSort
  filter: MediaFilter
}) {
  const { data, loading, error, fetchMore } = useQuery(LibraryPageDocument, {
    variables: { libraryId, first: PAGE_SIZE, sort, filter },
  })

  const letter = filter.startLetter ?? null
  const pageInfo = data?.library.items.pageInfo
  // Each committed query owns its in-flight pages. Apollo applies updateQuery to the current
  // variables, so a response from an earlier query must not write into the new result.
  const requestScope = useMemo(
    () => ({ active: false, fetchingNext: false, previousRequest: null as Promise<string | null> | null }),
    [libraryId, JSON.stringify(sort), JSON.stringify(filter)],
  )
  useLayoutEffect(() => {
    requestScope.active = true
    return () => { requestScope.active = false }
  }, [requestScope])

  const [centering, setCentering] = useState(false)
  const [landing, setLanding] = useState<{
    cursor: string | null
    precedingCursor?: string | null
    scope: typeof requestScope
  } | null>(null)
  const previousLetterRef = useRef<typeof letter>(undefined as unknown as typeof letter)

  // The forward seek page is just the variables change above; this adds the one-shot backward
  // continuity fetch (streamarr-apple's jumpToLetter) and records the item to scroll into view.
  useEffect(() => {
    const previousLetter = previousLetterRef.current
    previousLetterRef.current = letter
    if (letter && letter !== previousLetter) {
      setCentering(true)
    }
  }, [letter])

  useEffect(() => {
    if (!centering || loading || !pageInfo) {
      return
    }
    setCentering(false)
    // Cached seek pages can already contain earlier rows from backward pagination.
    const edges = definedEdges(data?.library.items.edges)
    const landingEdge = edges.find((edge) =>
      alphabetLetterFromTitle(edge.node.titleSort ?? edge.node.title ?? '') === letter)
    const target = (landingEdge ?? edges[0])?.cursor ?? null
    const revealLanding = (precedingCursor?: string | null) => {
      if (requestScope.active) setLanding({ cursor: target, precedingCursor, scope: requestScope })
    }
    // A cached page may already be scrolled past the top sentinel, so its next prepend has no
    // sentinel measurement. Wait for that page to render, not merely for its request to settle.
    const previousPage = loadPrevious()
    if (previousPage) {
      void previousPage.then(
        revealLanding,
        () => revealLanding(),
      )
    } else {
      revealLanding()
    }
  }, [centering, loading, pageInfo])

  function loadMore() {
    if (!requestScope.active || !pageInfo?.hasNextPage || requestScope.fetchingNext) {
      return
    }
    requestScope.fetchingNext = true
    fetchMore({
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
      updateQuery: (previous, { fetchMoreResult }) => !requestScope.active ? previous : ({
        library: {
          ...fetchMoreResult.library,
          items: {
            ...previous.library.items,
            edges: [...(previous.library.items.edges ?? []), ...(fetchMoreResult.library.items.edges ?? [])],
            // The fetched page's own pageInfo describes that page's boundaries, not the merged
            // list's — hasPreviousPage/startCursor must stay as they were, or this reopens
            // backward pagination into content already loaded.
            pageInfo: {
              ...previous.library.items.pageInfo,
              hasNextPage: fetchMoreResult.library.items.pageInfo.hasNextPage,
              endCursor: fetchMoreResult.library.items.pageInfo.endCursor,
            },
          },
        },
      }),
    }).finally(() => {
      requestScope.fetchingNext = false
    })
  }

  // Ongoing backward pagination (streamarr-apple's loadPreviousPageIfNeeded), not just the
  // one-shot centering fetch above.
  function loadPrevious() {
    if (!requestScope.active) return
    if (requestScope.previousRequest) return requestScope.previousRequest
    if (!pageInfo?.hasPreviousPage || !pageInfo.startCursor) {
      return
    }
    // Once paginating via `before`, the cursor alone determines position (ADR 0018) — the seek
    // anchor has nothing left to do.
    const { startLetter: _startLetter, ...continuationFilter } = filter
    requestScope.previousRequest = fetchMore({
      variables: {
        libraryId,
        first: undefined,
        after: undefined,
        last: PAGE_SIZE,
        before: pageInfo.startCursor,
        sort,
        filter: continuationFilter,
      },
      updateQuery: (previous, { fetchMoreResult }) => !requestScope.active ? previous : ({
        library: {
          ...fetchMoreResult.library,
          items: {
            ...previous.library.items,
            edges: [...(fetchMoreResult.library.items.edges ?? []), ...(previous.library.items.edges ?? [])],
            pageInfo: {
              ...previous.library.items.pageInfo,
              hasPreviousPage: fetchMoreResult.library.items.pageInfo.hasPreviousPage,
              startCursor: fetchMoreResult.library.items.pageInfo.startCursor,
            },
          },
        },
      }),
    }).then((result) => result.data?.library.items.pageInfo.startCursor ?? null).finally(() => {
      requestScope.previousRequest = null
    })
    return requestScope.previousRequest
  }

  function clearScrollTarget() {
    setLanding(null)
  }

  return {
    loading: loading && !data,
    error,
    library: data?.library ?? null,
    edges: definedEdges(data?.library.items.edges ?? null),
    hasNextPage: pageInfo?.hasNextPage ?? false,
    hasPreviousPage: pageInfo?.hasPreviousPage ?? false,
    loadMore,
    loadPrevious,
    scrollTarget: landing?.scope === requestScope && (!landing.precedingCursor ||
      data?.library.items.edges?.some((edge) => edge?.cursor === landing.precedingCursor))
      ? landing.cursor : null,
    clearScrollTarget,
  }
}
