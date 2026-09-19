import { useQuery } from '@apollo/client/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
    () => ({
      active: false,
      fetchingNext: false,
      previousRequest: null as Promise<string | null> | null,
    }),
    // The scope is an identity per committed query: its dependencies are the query's variables by
    // value, not what the factory reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [libraryId, JSON.stringify(sort), JSON.stringify(filter)],
  )
  useLayoutEffect(
    function activateCommittedQuery() {
      requestScope.active = true
      return () => {
        requestScope.active = false
      }
    },
    [requestScope],
  )

  const [centering, setCentering] = useState(false)
  const [landing, setLanding] = useState<{
    cursor: string | null
    precedingCursor?: string | null
    scope: typeof requestScope
  } | null>(null)
  const previousLetterRef = useRef<typeof letter>(undefined as unknown as typeof letter)

  useEffect(
    function beginLetterJump() {
      const previousLetter = previousLetterRef.current
      previousLetterRef.current = letter
      if (letter && letter !== previousLetter) {
        setCentering(true)
      }
    },
    [letter],
  )

  useEffect(
    function loadPrecedingPageForLetterJump() {
      if (!centering || loading || !pageInfo) {
        return
      }
      // Centering is a one-shot request; consuming it here is what keeps the jump from repeating.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCentering(false)
      const target = findLetterLandingCursor(data?.library.items.edges, letter)
      const revealLanding = (precedingCursor?: string | null) => {
        if (requestScope.active)
          setLanding({ cursor: target, precedingCursor, scope: requestScope })
      }
      const previousPage = loadPrevious()
      if (previousPage) {
        void previousPage.then(revealLanding, () => revealLanding())
      } else {
        revealLanding()
      }
    },
    // Runs when a jump is requested or its page settles. The rest is read fresh and must not
    // retrigger the jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [centering, loading, pageInfo],
  )

  function loadMore() {
    if (!requestScope.active || !pageInfo?.hasNextPage || requestScope.fetchingNext) {
      return
    }
    requestScope.fetchingNext = true
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
        !requestScope.active || previous.library.items.pageInfo.endCursor !== pageInfo.endCursor
          ? previous
          : {
              library: {
                ...fetchMoreResult.library,
                items: appendItemsPage(previous.library.items, fetchMoreResult.library.items),
              },
            },
    }).finally(() => {
      requestScope.fetchingNext = false
    })
  }

  function loadPrevious() {
    if (!requestScope.active) return
    if (requestScope.previousRequest) return requestScope.previousRequest
    if (!pageInfo?.hasPreviousPage || !pageInfo.startCursor) {
      return
    }
    // A `before` cursor replaces the letter seek anchor (ADR 0018).
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
      updateQuery: (previous, { fetchMoreResult }) =>
        !requestScope.active || previous.library.items.pageInfo.startCursor !== pageInfo.startCursor
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
        requestScope.previousRequest = null
      })
    return requestScope.previousRequest
  }

  function clearScrollTarget() {
    setLanding(null)
  }

  function getReadyScrollTarget() {
    if (!landing || landing.scope !== requestScope) return null
    // A completed request may still be waiting for its rows to render.
    const precedingPageHasRendered =
      !landing.precedingCursor ||
      data?.library.items.edges?.some((edge) => edge?.cursor === landing.precedingCursor)
    return precedingPageHasRendered ? landing.cursor : null
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
    scrollTarget: getReadyScrollTarget(),
    clearScrollTarget,
  }
}

function findLetterLandingCursor(edges: LibraryItems['edges'] | undefined, letter: string | null) {
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
