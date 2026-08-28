import { useQuery } from '@apollo/client/react'
import { useEffect, useRef, useState } from 'react'
import { LibraryPageDocument, type MediaFilter, type MediaSort } from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'

const PAGE_SIZE = 24

// Filter/sort/letter come in as props (owned by the route's search params), so a plain change
// to any of them is a normal Apollo variables change: the library refetches its landing page and
// any edges accumulated by loadMore are naturally dropped, no bespoke reset needed here.
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

  const [centering, setCentering] = useState(false)
  const previousLetterRef = useRef<typeof letter>(undefined as unknown as typeof letter)

  // A letter tap's forward seek page is just the variables change above; this effect adds
  // streamarr-apple's one-shot backward continuity fetch once that landing page has settled, so
  // scrolling up from the jump target isn't a dead end (LibraryDetailViewModel.jumpToLetter).
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
    if (!pageInfo.hasPreviousPage || !pageInfo.startCursor) {
      return
    }
    fetchMore({
      // fetchMore shallow-merges these onto the observable query's *current* variables, so the
      // opposite-direction cursor args must be cleared explicitly or `first`/`after` leak in
      // alongside `last`/`before`.
      variables: {
        libraryId,
        first: undefined,
        after: undefined,
        last: PAGE_SIZE,
        before: pageInfo.startCursor,
        sort,
        filter,
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
    })
    // pageInfo's identity changes on every fetch; centering/loading gate when this body actually runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centering, loading, pageInfo])

  function loadMore() {
    if (!pageInfo?.hasNextPage) {
      return
    }
    fetchMore({
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
            ...fetchMoreResult.library.items,
            edges: [...(previous.library.items.edges ?? []), ...(fetchMoreResult.library.items.edges ?? [])],
          },
        },
      }),
    })
  }

  return {
    loading: loading && !data,
    error,
    library: data?.library ?? null,
    edges: definedEdges(data?.library.items.edges ?? null),
    hasNextPage: pageInfo?.hasNextPage ?? false,
    loadMore,
  }
}
