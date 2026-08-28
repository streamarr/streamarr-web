import { useQuery } from '@apollo/client/react'
import { useEffect, useRef, useState } from 'react'
import { LibraryPageDocument, type MediaFilter, type MediaSort } from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'

const PAGE_SIZE = 24

// Filter/sort/letter come in as props (owned by the route's search params), so a plain change
// to any of them is a normal Apollo variables change: the library refetches its landing page and
// any edges accumulated by loadMore/loadPrevious are naturally dropped, no bespoke reset needed.
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

  // A letter tap's forward seek page is just the variables change above (Apollo refetches for the
  // new startLetter); this effect adds streamarr-apple's one-shot backward continuity fetch once
  // that landing page has settled, so scrolling up from the jump target isn't a dead end
  // (LibraryDetailViewModel.jumpToLetter), and records which item to scroll into view.
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
    // pageInfo's identity changes on every fetch; centering/loading gate when this body actually
    // runs, and loadPrevious/data close over the current render's values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centering, loading, pageInfo])

  function loadMore() {
    if (!pageInfo?.hasNextPage || fetchingNextRef.current) {
      return
    }
    fetchingNextRef.current = true
    fetchMore({
      // fetchMore shallow-merges these onto the observable query's *current* variables, so the
      // opposite-direction cursor args must be cleared explicitly or `last`/`before` leak in
      // alongside `first`/`after`.
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
            // The fetched page's own pageInfo describes *that page's* boundaries (e.g. it always
            // has something before it once you're on page 2) — not the overall merged list's.
            // Only the forward edge actually moved; hasPreviousPage/startCursor must stay as they
            // were, or a spurious hasPreviousPage: true reopens backward pagination into content
            // already loaded, duplicating it.
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
  // one-shot centering fetch: scrolling up keeps loading previous pages all the way back to the
  // start of the library, exactly like scrolling down keeps loading forward via loadMore.
  function loadPrevious() {
    if (!pageInfo?.hasPreviousPage || !pageInfo.startCursor || fetchingPreviousRef.current) {
      return
    }
    fetchingPreviousRef.current = true
    // Drops startLetter, matching streamarr-apple's fetchPreviousPage: once paginating via a
    // `before` cursor, the seek anchor has nothing left to do (the cursor alone determines
    // position under TITLE sort — server ADR 0018), so there is nothing to resend.
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
