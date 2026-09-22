import { Alert, Anchor, Center, Loader, Text, Title } from '@mantine/core'
import { useElementSize, useMergedRef } from '@mantine/hooks'
import { Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import type { Store } from '@tanstack/store'
import { motion, useReducedMotion, type Variants } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  MediaFilter,
  MediaSort,
  OrderMediaBy,
  SortDirection,
} from '../graphql/generated/graphql'
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
}: Readonly<{
  libraryId: string
  search: LibrarySearch
  onSearchChange: (search: LibrarySearch) => void
}>) {
  const sort: MediaSort = { by: search.by, direction: search.direction }
  const trackingLetter = sort.by === 'TITLE'
  // The server's alphabet index is unfiltered, and letter seeking requires TITLE sort (ADR 0023).
  const canSeekByLetter = trackingLetter && !search.watchStatus
  const filter: MediaFilter = {
    watchStatus: search.watchStatus,
    startLetter: canSeekByLetter ? (search.letter as MediaFilter['startLetter']) : undefined,
  }

  const {
    loading,
    pending,
    staged,
    accept,
    error,
    library,
    edges,
    hasNextPage,
    hasPreviousPage,
    loadMore,
    loadPrevious,
    retry,
    landing,
  } = useLibraryItems({ libraryId, sort, filter })

  // State lets observers attach to the grid after it mounts; the ref is the handle the layout
  // effects scroll.
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null)
  const gridNodeRef = useRef<HTMLDivElement | null>(null)
  const { ref: measureGrid, height: gridHeight } = useElementSize<HTMLDivElement>()
  const gridRef = useMergedRef(setGridElement, measureGrid, gridNodeRef)
  // IntersectionObserver requires pixels here; vh/dvh units are unsupported.
  const halfViewportPrefetchMargin = `${gridHeight / 2}px 0px`
  const itemElementsRef = useRef(new Map<string, HTMLElement>())
  const { visibleLetterStore, registerItem } = useVisibleLetter(gridElement)

  const loadMoreRef = useIntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMore()
      }
    },
    { root: gridElement, rootMargin: halfViewportPrefetchMargin },
  )

  const loadPreviousRef = useIntersectionObserver(
    function loadPreviousPage(entries) {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadPrevious()
      }
    },
    { root: gridElement, rootMargin: halfViewportPrefetchMargin },
  )

  const frameRef = useRef<HTMLDivElement>(null)
  const firstCursor = edges[0]?.cursor
  const firstRowRef = useRef<{ cursor: string; element: HTMLElement } | null>(null)
  // Rows are measured by offsetTop, which the grid's slide transform does not disturb. Both
  // effects list gridElement so they run again once the grid has mounted.
  useLayoutEffect(
    function keepRowsInPlaceAcrossPrepend() {
      const previousFirst = firstRowRef.current
      const first = firstCursor ? itemElementsRef.current.get(firstCursor) : undefined
      firstRowRef.current = first && firstCursor ? { cursor: firstCursor, element: first } : null
      const grid = gridNodeRef.current
      const prepended =
        previousFirst &&
        first &&
        previousFirst.cursor !== firstCursor &&
        previousFirst.element.isConnected
      if (!prepended || !grid) {
        return
      }
      grid.scrollTop += previousFirst.element.offsetTop - first.offsetTop
    },
    [firstCursor, gridElement],
  )

  // Before paint, because the grid keeps its previous scroll position across a new result. Once
  // per result: later pages merge into the same result without moving it.
  const landingKey = landing?.key
  const landingCursor = landing?.cursor
  useLayoutEffect(
    function placeLandingRow() {
      const grid = gridNodeRef.current
      if (landingKey === undefined || !grid) {
        return
      }
      const row = landingCursor ? itemElementsRef.current.get(landingCursor) : undefined
      grid.scrollTop = row?.offsetTop ?? 0
      // A short page scrolls to the letter's row, through the frame the slide cannot move.
      if (row) {
        frameRef.current?.scrollIntoView({ block: 'start' })
      }
    },
    [landingKey, landingCursor, gridElement],
  )

  // A letter jump moves like the tvOS library: the grid leaves in the direction of travel at the
  // press, the rows swap while it is away, and it re-enters from the other side. A failed jump
  // brings the grid back as it was.
  const [jump, setJump] = useState<LetterJump | null>(null)
  const [gridHasLeft, setGridHasLeft] = useState(false)
  // Under reduced motion the grid only fades: the swap is a cut, never a slide.
  const reduceMotion = useReducedMotion() === true
  const jumping = jump !== null && !error
  const slide: SlidePhase = !jumping
    ? 'idle'
    : landing && jump.letter === search.letter
      ? 'enter'
      : 'exit'

  useEffect(
    function revealStagedResult() {
      if (!staged) {
        return
      }
      const gridIsLeaving = jump !== null && jump.letter === search.letter && !gridHasLeft
      if (!gridIsLeaving) {
        accept()
      }
    },
    [staged, accept, jump, search.letter, gridHasLeft],
  )

  function beginJump(next: LetterJump | null) {
    setJump(next)
    // A grid that has already left, or is leaving, stays away for the next letter.
    setGridHasLeft(next !== null && slide === 'exit' && gridHasLeft)
  }

  function selectFilter(status: WatchStatusFilter) {
    beginJump(null)
    onSearchChange({
      ...search,
      letter: undefined,
      watchStatus: status === 'ALL' ? undefined : status,
    })
  }

  function selectSort(nextSort: MediaSort) {
    beginJump(null)
    const by = nextSort.by ?? search.by
    onSearchChange({
      ...search,
      by,
      direction: nextSort.direction ?? search.direction,
      letter: by === 'TITLE' ? search.letter : undefined,
    })
  }

  function selectLetter(letter: string | null) {
    const viewedLetter = visibleLetterStore.state ?? search.letter ?? null
    beginJump(
      letter && library
        ? { letter, direction: directionOfJump(library.alphabetIndex, viewedLetter, letter) }
        : null,
    )
    onSearchChange(
      letter
        ? { ...search, by: 'TITLE', direction: 'ASC', letter }
        : { ...search, letter: undefined },
    )
  }

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  if (!library) {
    return <LibraryUnavailable onRetry={retry} />
  }

  const total = library.alphabetIndex.reduce((sum, entry) => sum + entry.count, 0)
  const scanLabel = library.scanCompletedOn
    ? `last scan ${formatRelativeTime(library.scanCompletedOn)}`
    : 'scanning…'

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

      {error && <LibraryUnavailable onRetry={retry} />}

      <div className={styles.body}>
        {edges.length === 0 ? (
          <Text className={styles.empty}>No items match this filter.</Text>
        ) : (
          <div className={styles.gridFrame} ref={frameRef}>
            <motion.div
              className={styles.grid}
              ref={gridRef}
              data-scroll-restoration-id="library-grid"
              variants={slideVariants}
              custom={{ direction: jump?.direction, reduceMotion } satisfies SlideCustom}
              initial={false}
              animate={slide}
              onAnimationComplete={(completed) => {
                if (completed === 'exit') setGridHasLeft(true)
                if (completed === 'enter') beginJump(null)
              }}
            >
              {hasPreviousPage && (
                <div ref={loadPreviousRef} aria-hidden className={styles.sentinel} />
              )}
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
                      <Link
                        to="/movie/$movieId"
                        params={{ movieId: summary.id }}
                        className={styles.cardLink}
                      >
                        {card}
                      </Link>
                    ) : (
                      <Link
                        to="/series/$seriesId"
                        params={{ seriesId: summary.id }}
                        className={styles.cardLink}
                      >
                        {card}
                      </Link>
                    )}
                  </div>
                )
              })}
              {hasNextPage && <div ref={loadMoreRef} aria-hidden className={styles.sentinel} />}
            </motion.div>
          </div>
        )}
        {canSeekByLetter && (
          <LibraryRail
            index={library.alphabetIndex}
            visibleLetterStore={visibleLetterStore}
            letter={search.letter ?? null}
            pending={pending}
            onSelect={selectLetter}
          />
        )}
      </div>
    </div>
  )
}

// While a jump is pending the rail shows the letter asked for; otherwise it follows the grid.
function LibraryRail({
  index,
  visibleLetterStore,
  letter,
  pending,
  onSelect,
}: Readonly<{
  index: ReadonlyArray<{ letter: string; count: number }>
  visibleLetterStore: Store<string | null>
  letter: string | null
  pending: boolean
  onSelect: (letter: string | null) => void
}>) {
  const visibleLetter = useStore(visibleLetterStore, (current) => current)
  return (
    <AlphabetRail
      index={index}
      selected={pending ? letter : (visibleLetter ?? letter)}
      onSelect={onSelect}
    />
  )
}

type JumpDirection = 'forward' | 'backward'
type LetterJump = { letter: string; direction: JumpDirection }
type SlidePhase = 'idle' | 'exit' | 'enter'
type SlideCustom = { direction: JumpDirection | undefined; reduceMotion: boolean }

// The tvOS library's travel and timings.
const JUMP_TRAVEL = 120
const slideVariants: Variants = {
  idle: { opacity: 1, y: 0, transition: { duration: 0.15 } },
  exit: ({ direction, reduceMotion }: SlideCustom) => ({
    opacity: 0,
    y: reduceMotion ? 0 : direction === 'forward' ? -JUMP_TRAVEL : JUMP_TRAVEL,
    transition: { duration: 0.15, ease: 'easeIn' },
  }),
  enter: ({ direction, reduceMotion }: SlideCustom) => ({
    opacity: [0, 1],
    y: reduceMotion ? 0 : [direction === 'forward' ? JUMP_TRAVEL : -JUMP_TRAVEL, 0],
    transition: { duration: 0.2, ease: 'easeOut' },
  }),
}

function directionOfJump(
  index: ReadonlyArray<{ letter: string }>,
  from: string | null,
  to: string,
): JumpDirection {
  // Titles under '#' sort before A, although the rail lists '#' last.
  const position = (letter: string | null) =>
    letter === 'HASH' ? -1 : index.findIndex((entry) => entry.letter === letter)
  return position(to) < position(from) ? 'backward' : 'forward'
}

function LibraryUnavailable({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <Alert color="red" role="alert">
      Couldn't load this library.{' '}
      <Anchor component="button" type="button" onClick={onRetry}>
        Try again
      </Anchor>
    </Alert>
  )
}

function buildShowingLabel(
  loadedCount: number,
  hasNextPage: boolean,
  isUnfiltered: boolean,
  total: number,
): string {
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
