import { Alert, Center, Loader, Text, Title } from '@mantine/core'
import { useElementSize, useMergedRef } from '@mantine/hooks'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MediaFilter, MediaSort, OrderMediaBy, SortDirection } from '../graphql/generated/graphql'
import { AlphabetRail } from '../media/AlphabetRail'
import { formatRelativeTime } from '../media/formatting'
import { PosterCard } from '../media/PosterCard'
import { summarizeMedia, summaryLetter } from '../media/summarizeMedia'
import { useIntersectionObserver } from '../media/useIntersectionObserver'
import { badgeFromWatchState } from '../media/WatchedBadge'
import { FilterBar, type WatchStatusFilter } from './FilterBar'
import styles from './LibraryScreen.module.css'
import { SortMenu } from './SortMenu'
import { useLibraryItems } from './useLibraryItems'
import { useVisibleLetter } from './useVisibleLetter'

export interface LibrarySearch {
  by: OrderMediaBy
  direction: SortDirection
  watchStatus?: 'UNWATCHED' | 'IN_PROGRESS'
  letter?: string
}

export function LibraryScreen({
  libraryId,
  search,
  onSearchChange,
}: {
  libraryId: string
  search: LibrarySearch
  onSearchChange: (search: LibrarySearch) => void
}) {
  const sort: MediaSort = { by: search.by, direction: search.direction }
  const trackingLetter = sort.by === 'TITLE'
  // The server's alphabet index is unfiltered, and letter seeking requires TITLE sort (ADR 0018).
  const canSeekByLetter = trackingLetter && !search.watchStatus
  const filter: MediaFilter = {
    watchStatus: search.watchStatus,
    startLetter: canSeekByLetter ? search.letter as MediaFilter['startLetter'] : undefined,
  }

  const {
    loading,
    error,
    library,
    edges,
    hasNextPage,
    hasPreviousPage,
    loadMore,
    loadPrevious,
    scrollTarget,
    clearScrollTarget,
  } = useLibraryItems({ libraryId, sort, filter })

  // State lets observers attach to the grid after it mounts.
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null)
  const { ref: measureGrid, height: gridHeight } = useElementSize<HTMLDivElement>()
  const gridRef = useMergedRef(setGridElement, measureGrid)
  // IntersectionObserver requires pixels here; vh/dvh units are unsupported.
  const halfViewportPrefetchMargin = `${gridHeight / 2}px 0px`
  const itemElementsRef = useRef(new Map<string, HTMLElement>())
  const { visibleLetter, registerItem } = useVisibleLetter(gridElement)

  const loadMoreRef = useIntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMore()
      }
    },
    { root: gridElement, rootMargin: halfViewportPrefetchMargin },
  )

  const heightBeforePrependRef = useRef<number | null>(null)
  useLayoutEffect(function resetScrollAnchorForQuery() {
    heightBeforePrependRef.current = null
  }, [libraryId, sort.by, sort.direction, filter.watchStatus, filter.startLetter])

  const loadPreviousRef = useIntersectionObserver(
    function loadPreviousPageWithScrollAnchor(entries) {
      if (entries.some((entry) => entry.isIntersecting) && gridElement) {
        heightBeforePrependRef.current = gridElement.scrollHeight
        loadPrevious()
      }
    },
    { root: gridElement, rootMargin: halfViewportPrefetchMargin },
  )

  useLayoutEffect(function restoreScrollAfterPrepend() {
    const heightBefore = heightBeforePrependRef.current
    if (heightBefore === null || !gridElement) {
      return
    }
    const addedHeight = gridElement.scrollHeight - heightBefore
    // A render can occur before the requested page adds any height.
    if (addedHeight > 0) {
      gridElement.scrollTop += addedHeight
      heightBeforePrependRef.current = null
    }
  }, [edges.length, edges[0]?.cursor, gridElement])

  useEffect(function scrollToLetterLanding() {
    if (!scrollTarget) {
      return
    }
    const element = itemElementsRef.current.get(scrollTarget)
    if (element) {
      element.scrollIntoView({ block: 'start' })
      clearScrollTarget()
    }
  }, [scrollTarget, edges, clearScrollTarget])

  function selectFilter(status: WatchStatusFilter) {
    onSearchChange({ ...search, letter: undefined, watchStatus: status === 'ALL' ? undefined : status })
  }

  function selectSort(nextSort: MediaSort) {
    const by = nextSort.by ?? search.by
    onSearchChange({
      ...search,
      by,
      direction: nextSort.direction ?? search.direction,
      letter: by === 'TITLE' ? search.letter : undefined,
    })
  }

  function selectLetter(letter: string | null) {
    onSearchChange(letter ? { ...search, by: 'TITLE', direction: 'ASC', letter } : { ...search, letter: undefined })
  }

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  if (error || !library) {
    return (
      <Alert color="red" role="alert">
        Couldn't load this library. Try again.
      </Alert>
    )
  }

  const total = library.alphabetIndex.reduce((sum, entry) => sum + entry.count, 0)
  const scanLabel = library.scanCompletedOn ? `last scan ${formatRelativeTime(library.scanCompletedOn)}` : 'scanning…'

  return (
    <div className={styles.libraryScreen}>
      <div className={styles.header}>
        <Title order={1} className={styles.libraryName}>
          {library.name ?? 'Library'}
        </Title>
        <Text className={styles.scanStatus}>
          {total.toLocaleString()} items · {scanLabel}
        </Text>
        <div className={styles.sortSlot}>
          <SortMenu sort={sort} onChange={selectSort} />
        </div>
      </div>

      <FilterBar
        status={search.watchStatus ?? 'ALL'}
        onChange={selectFilter}
        showing={buildShowingLabel(edges.length, hasNextPage, !search.watchStatus, total)}
      />

      <div className={styles.body}>
        {edges.length === 0 ? (
          <Text className={styles.empty}>No items match this filter.</Text>
        ) : (
          <div className={styles.grid} ref={gridRef}>
            {hasPreviousPage && <div ref={loadPreviousRef} aria-hidden className={styles.sentinel} />}
            {edges.map((edge) => {
              const summary = summarizeMedia(edge.node)
              const letter = trackingLetter ? summaryLetter(summary) : null
              return (
                <div
                  key={edge.cursor}
                  ref={(element: HTMLDivElement | null) => {
                    if (!element) {
                      return undefined
                    }
                    itemElementsRef.current.set(edge.cursor, element)
                    const disconnectObserver = letter ? registerItem(letter)(element) : undefined
                    return () => {
                      itemElementsRef.current.delete(edge.cursor)
                      disconnectObserver?.()
                    }
                  }}
                >
                  <PosterCard
                    title={summary.title}
                    meta={summary.meta}
                    image={summary.poster}
                    blurHash={summary.blurHash}
                    badge={badgeFromWatchState(summary.watchStatus, summary.percentComplete)}
                  />
                </div>
              )
            })}
            {hasNextPage && <div ref={loadMoreRef} aria-hidden className={styles.sentinel} />}
          </div>
        )}
        {canSeekByLetter && (
          <AlphabetRail
            index={library.alphabetIndex}
            selected={visibleLetter ?? search.letter ?? null}
            onSelect={selectLetter}
          />
        )}
      </div>
    </div>
  )
}

function buildShowingLabel(loadedCount: number, hasNextPage: boolean, isUnfiltered: boolean, total: number): string {
  if (loadedCount === 0) {
    return 'No items'
  }
  if (isUnfiltered) {
    return `Showing 1–${loadedCount} of ${total.toLocaleString()}`
  }
  if (!hasNextPage) {
    return `Showing 1–${loadedCount} of ${loadedCount}`
  }
  return `Showing 1–${loadedCount}`
}
