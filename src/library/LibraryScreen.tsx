import { Alert, Center, Loader, Text, Title } from '@mantine/core'
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

  const { loading, error, library, edges, hasNextPage, loadMore } = useLibraryItems({ libraryId, sort, filter })
  const { visibleLetter, registerItem } = useVisibleLetter()

  const loadMoreRef = useIntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMore()
      }
    },
    { rootMargin: '400px' },
  )

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

  // startLetter is only a seek anchor under TITLE sort (server ADR 0018) — under any other sort
  // it becomes a strict equality filter that would silently shrink the library to one letter, so
  // a tap always forces TITLE/ASC first.
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
          <div className={styles.grid}>
            {edges.map((edge) => {
              const summary = summarizeMedia(edge.node)
              return (
                <div key={edge.cursor} ref={trackingLetter ? registerItem(summaryLetter(summary)) : undefined}>
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
        <AlphabetRail
          index={library.alphabetIndex}
          selected={trackingLetter ? (visibleLetter ?? search.letter ?? null) : null}
          onSelect={selectLetter}
        />
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
