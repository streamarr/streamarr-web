import { Alert, Center, Loader, Text, Title } from '@mantine/core'
import { Link } from '@tanstack/react-router'
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
  const filter: MediaFilter = {
    watchStatus: search.watchStatus,
    // Only ever populated by AlphabetRail taps sourced from real alphabetIndex letters.
    startLetter: search.letter as MediaFilter['startLetter'],
  }
  const trackingLetter = sort.by === 'TITLE'

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

  // State, not a ref object: the sentinels' observer root is the grid, and needs to rebuild once
  // it actually mounts, which only a state-backed ref triggers.
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null)
  const itemElementsRef = useRef(new Map<string, HTMLElement>())
  const { visibleLetter, registerItem } = useVisibleLetter(gridElement)

  const loadMoreRef = useIntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMore()
      }
    },
    { root: gridElement, rootMargin: '400px' },
  )

  // The top sentinel is always the grid's first child, so a prepend alone never moves it out of
  // the intersecting zone; scrollTop must be compensated below or it never fires again.
  const pendingBackwardMeasurementRef = useRef<number | null>(null)
  const loadPreviousRef = useIntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting) && gridElement) {
        pendingBackwardMeasurementRef.current = gridElement.scrollHeight
        loadPrevious()
      }
    },
    { root: gridElement, rootMargin: '400px' },
  )

  useLayoutEffect(() => {
    const heightBefore = pendingBackwardMeasurementRef.current
    if (heightBefore === null || !gridElement) {
      return
    }
    const delta = gridElement.scrollHeight - heightBefore
    // Only clear once growth is observed: this can re-run before the fetch has actually landed
    // (edges is a fresh array every render), and clearing on that zero-delta pass would drop the
    // pending measurement before the real page arrives.
    if (delta > 0) {
      gridElement.scrollTop += delta
      pendingBackwardMeasurementRef.current = null
    }
  }, [edges.length, edges[0]?.cursor, gridElement])

  // Scrolls the letter-jump's landing item into view once rendered, or the backward continuity
  // page prepended above it reads as having landed on the wrong letter.
  useEffect(() => {
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
    onSearchChange({ ...search, watchStatus: status === 'ALL' ? undefined : status })
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

  // startLetter is only a seek anchor under TITLE sort (ADR 0018) — otherwise it's a strict
  // filter that would shrink the library to one letter, so a tap forces TITLE/ASC first.
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
          <div className={styles.grid} ref={setGridElement}>
            {hasPreviousPage && <div ref={loadPreviousRef} aria-hidden className={styles.sentinel} />}
            {edges.map((edge) => {
              const summary = summarizeMedia(edge.node)
              const letter = trackingLetter ? summaryLetter(summary) : null
              const card = (
                <PosterCard
                  title={summary.title}
                  meta={summary.meta}
                  image={summary.poster}
                  blurHash={summary.blurHash}
                  badge={badgeFromWatchState(summary.watchStatus, summary.percentComplete)}
                />
              )
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
                  {edge.node.__typename === 'Movie' ? (
                    <Link to="/movie/$movieId" params={{ movieId: summary.id }} className={styles.cardLink}>
                      {card}
                    </Link>
                  ) : (
                    <Link to="/series/$seriesId" params={{ seriesId: summary.id }} className={styles.cardLink}>
                      {card}
                    </Link>
                  )}
                </div>
              )
            })}
            {hasNextPage && <div ref={loadMoreRef} aria-hidden className={styles.sentinel} />}
          </div>
        )}
        {/* startLetter is only a seek anchor under TITLE sort (ADR 0018) — a tap under any other
            sort would silently shrink the library to one letter, and alphabetIndex itself has no
            filter argument to reflect a watch-status filter either. */}
        {!search.watchStatus && trackingLetter && (
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
