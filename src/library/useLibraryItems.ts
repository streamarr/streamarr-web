import { useQuery } from '@apollo/client/react'
import { useEffect, useRef, useState } from 'react'
import { LibraryPageDocument, type MediaFilter, type MediaSort } from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'

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
  const fetchingNextRef = useRef(false)
  const fetchingPreviousRef = useRef(false)

  const [centering, setCentering] = useState(false)
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
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
    setScrollTarget(data?.library.items.edges?.[0]?.cursor ?? null)
    loadPrevious()
  }, [centering, loading, pageInfo])

  function loadMore() {
    if (!pageInfo?.hasNextPage || fetchingNextRef.current) {
      return
    }
    fetchingNextRef.current = true
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
      updateQuery: (previous, { fetchMoreResult }) => ({
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
      fetchingNextRef.current = false
    })
  }

  // Ongoing backward pagination (streamarr-apple's loadPreviousPageIfNeeded), not just the
  // one-shot centering fetch above.
  function loadPrevious() {
    if (!pageInfo?.hasPreviousPage || !pageInfo.startCursor || fetchingPreviousRef.current) {
      return
    }
    fetchingPreviousRef.current = true
    // Once paginating via `before`, the cursor alone determines position (ADR 0018) — the seek
    // anchor has nothing left to do.
    const { startLetter: _startLetter, ...continuationFilter } = filter
    fetchMore({
      variables: {
        libraryId,
        first: undefined,
        after: undefined,
        last: PAGE_SIZE,
        before: pageInfo.startCursor,
        sort,
        filter: continuationFilter,
      },
      updateQuery: (previous, { fetchMoreResult }) => ({
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
    }).finally(() => {
      fetchingPreviousRef.current = false
    })
  }

  function clearScrollTarget() {
    setScrollTarget(null)
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
    scrollTarget,
    clearScrollTarget,
  }
}
