import { useElementSize, useMergedRef } from '@mantine/hooks'
import { Link } from '@tanstack/react-router'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import type { Store } from '@tanstack/store'
import { motion, type AnimationDefinition, type Variants } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PosterCard } from '../media/PosterCard'
import { summarizeMedia, summaryLetter } from '../media/summarizeMedia'
import { useIntersectionObserver } from '../media/useIntersectionObserver'
import { badgeFromWatchState } from '../media/WatchedBadge'
import styles from './LibraryScreen.module.css'
import type { useLibraryItems } from './useLibraryItems'

type LibraryItems = ReturnType<typeof useLibraryItems>
type LibraryEdge = LibraryItems['edges'][number]

export type JumpDirection = 'forward' | 'backward'
export type SlidePhase = 'idle' | 'exit' | 'enter'
type SlideCustom = { direction: JumpDirection | undefined; reduceMotion: boolean }

// Every row is the same height: posters share an aspect ratio and their text stays on one line,
// so one rendered row measures the geometry that places all of them. Until a row has been
// measured the grid guesses, which only matters where nothing is laid out at all.
type RowGeometry = { columns: number; rowHeight: number; rowGap: number; measured: boolean }
const UNMEASURED_ROWS: RowGeometry = { columns: 1, rowHeight: 320, rowGap: 0, measured: false }
const OVERSCAN_ROWS = 2

// Rows are virtual: only those near the viewport exist in the DOM, positioned inside a spacer
// the height of the whole list. The spacer's ends carry the paging sentinels.
export function LibraryGrid({
  edges,
  trackingLetter,
  hasPreviousPage,
  hasNextPage,
  loadMore,
  loadPrevious,
  landing,
  locationKey,
  restoredScrollY,
  repeatLanding,
  visibleLetterStore,
  slide,
  direction,
  reduceMotion,
  onSlideComplete,
}: Readonly<{
  edges: LibraryItems['edges']
  trackingLetter: boolean
  hasPreviousPage: boolean
  hasNextPage: boolean
  loadMore: LibraryItems['loadMore']
  loadPrevious: LibraryItems['loadPrevious']
  locationKey: string | undefined
  restoredScrollY: number | undefined
  repeatLanding: number
  landing: LibraryItems['landing']
  visibleLetterStore: Store<string | null>
  slide: SlidePhase
  direction: JumpDirection | undefined
  reduceMotion: boolean
  onSlideComplete: (definition: AnimationDefinition) => void
}>) {
  // State lets observers attach to the grid after it mounts; the ref is the handle the layout
  // effects scroll; the size feeds the prefetch margin and re-measures rows on a width change.
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null)
  const gridNodeRef = useRef<HTMLDivElement | null>(null)
  const {
    ref: measureGrid,
    width: gridWidth,
    height: gridHeight,
  } = useElementSize<HTMLDivElement>()
  const gridRef = useMergedRef(setGridElement, measureGrid, gridNodeRef)
  const frameRef = useRef<HTMLDivElement>(null)
  const probeRowRef = useRef<HTMLDivElement | null>(null)

  const [geometry, setGeometry] = useState(UNMEASURED_ROWS)
  const { virtualizer, rows, totalSize, topRow } = useVirtualRows({
    count: Math.ceil(edges.length / geometry.columns),
    getScrollElement: () => gridElement,
    estimateSize: () => geometry.rowHeight,
    gap: geometry.rowGap,
    overscan: OVERSCAN_ROWS,
    // Keyed by first title, so a page prepended in whole rows keeps the rows in view mounted.
    getItemKey: (row) => edges[row * geometry.columns]?.cursor ?? row,
  })

  // Measured once rows exist, and again whenever the grid's width changes.
  const hasRows = rows.length > 0
  useLayoutEffect(
    function measureRows() {
      const row = probeRowRef.current
      if (!row) {
        return
      }
      const next = measureRowGeometry(row)
      if (!next || sameGeometry(next, geometry)) {
        return
      }
      setGeometry(next)
      // The virtualizer re-reads the row estimate only after a measure().
      virtualizer.measure()
    },
    [hasRows, gridWidth, geometry, virtualizer],
  )

  // IntersectionObserver requires pixels here; vh/dvh units are unsupported.
  const halfViewportPrefetchMargin = `${gridHeight / 2}px 0px`
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

  const landingKey = landing?.key
  const landingCursor = landing?.cursor

  // A page prepended above moves every row down by whole rows; the viewer's rows stay put. Only
  // within one result: another query's rows may repeat a title without having grown above it.
  const firstCursor = edges[0]?.cursor
  const previousFirstRef = useRef({ key: landingKey, cursor: firstCursor })
  useLayoutEffect(
    function keepRowsInPlaceAcrossPrepend() {
      const previous = previousFirstRef.current
      previousFirstRef.current = { key: landingKey, cursor: firstCursor }
      const grid = gridNodeRef.current
      if (!grid || previous.key !== landingKey || previous.cursor === firstCursor) {
        return
      }
      const shifted = edges.findIndex((edge) => edge.cursor === previous.cursor)
      if (shifted <= 0) {
        return
      }
      grid.scrollTop += rowStart(virtualizer, Math.floor(shifted / geometry.columns))
    },
    [landingKey, firstCursor, edges, gridElement, geometry.columns, virtualizer],
  )

  // Before paint, once per result: later pages merge into the same result without moving it. A
  // letter's row needs measured geometry; the top does not.
  const placedResult = useRef<{
    locationKey: string | undefined
    landingKey: string
    repeatLanding: number
  } | null>(null)
  useLayoutEffect(
    function placeLandingRow() {
      const grid = gridNodeRef.current
      if (
        landingKey === undefined ||
        !grid ||
        (placedResult.current?.locationKey === locationKey &&
          placedResult.current?.landingKey === landingKey &&
          placedResult.current?.repeatLanding === repeatLanding)
      ) {
        return
      }
      if (!geometry.measured) {
        return
      }
      const repeated =
        placedResult.current !== null && placedResult.current.repeatLanding !== repeatLanding
      placedResult.current = { locationKey, landingKey, repeatLanding }
      if (restoredScrollY !== undefined && !repeated) {
        grid.scrollTop = restoredScrollY
        return
      }
      const cursorIndex = landingCursor
        ? edges.findIndex((edge) => edge.cursor === landingCursor)
        : -1
      if (cursorIndex < 0) {
        grid.scrollTop = 0
        return
      }
      grid.scrollTop = rowStart(virtualizer, Math.floor(cursorIndex / geometry.columns))
      // A short page scrolls to the letter's row, through the frame the slide cannot move.
      frameRef.current?.scrollIntoView({ block: 'start' })
    },
    [
      landingKey,
      landingCursor,
      gridElement,
      geometry,
      edges,
      virtualizer,
      locationKey,
      restoredScrollY,
      repeatLanding,
    ],
  )

  // The rail follows the row at the top of the grid; only the rail subscribes to the store.
  const topEdge = edges[topRow * geometry.columns]
  const topLetter = trackingLetter && topEdge ? summaryLetter(summarizeMedia(topEdge.node)) : null

  useEffect(
    function publishVisibleLetter() {
      visibleLetterStore.setState(() => topLetter)
    },
    [topLetter, visibleLetterStore],
  )
  useEffect(
    function clearVisibleLetterOnUnmount() {
      return () => visibleLetterStore.setState(() => null)
    },
    [visibleLetterStore],
  )

  const probeRowIndex = rows[0]?.index
  return (
    <div className={styles.gridFrame} ref={frameRef}>
      <motion.div
        className={styles.grid}
        ref={gridRef}
        data-scroll-restoration-id="library-grid"
        variants={slideVariants}
        custom={{ direction, reduceMotion } satisfies SlideCustom}
        initial={false}
        animate={slide}
        onAnimationComplete={onSlideComplete}
      >
        <div className={styles.rows} style={{ height: totalSize }}>
          {hasPreviousPage && (
            <div ref={loadPreviousRef} aria-hidden className={styles.sentinel} data-edge="start" />
          )}
          {rows.map((row) => {
            const first = row.index * geometry.columns
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={row.index === probeRowIndex ? probeRowRef : undefined}
                className={styles.row}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {edges.slice(first, first + geometry.columns).map((edge) => (
                  <LibraryCard key={edge.cursor} edge={edge} />
                ))}
              </div>
            )
          })}
          {hasNextPage && (
            <div ref={loadMoreRef} aria-hidden className={styles.sentinel} data-edge="end" />
          )}
        </div>
      </motion.div>
    </div>
  )
}

// The React Compiler skips any function that calls useVirtualizer, whose instance keeps one
// identity while its range changes; kept apart so the grid itself still compiles.
function useVirtualRows(options: Parameters<typeof useVirtualizer<HTMLDivElement, Element>>[0]) {
  const virtualizer = useVirtualizer(options)
  return {
    virtualizer,
    rows: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    topRow: virtualizer.range?.startIndex ?? 0,
  }
}

function rowStart(virtualizer: Virtualizer<HTMLDivElement, Element>, row: number) {
  return virtualizer.measurementsCache[row]?.start ?? 0
}

function measureRowGeometry(row: HTMLElement): RowGeometry | null {
  const rowHeight = Math.ceil(row.getBoundingClientRect().height)
  if (rowHeight === 0) {
    return null
  }
  const style = getComputedStyle(row)
  const tracks = style.gridTemplateColumns.split(' ').filter(Boolean).length
  return {
    columns: Math.max(1, tracks),
    rowHeight,
    rowGap: Number.parseFloat(style.rowGap) || 0,
    measured: true,
  }
}

function sameGeometry(a: RowGeometry, b: RowGeometry) {
  return a.columns === b.columns && a.rowHeight === b.rowHeight && a.rowGap === b.rowGap
}

function LibraryCard({ edge }: Readonly<{ edge: LibraryEdge }>) {
  const summary = summarizeMedia(edge.node)
  const card = (
    <PosterCard
      title={summary.title}
      meta={summary.meta}
      image={summary.poster}
      blurHash={summary.blurHash}
      badge={badgeFromWatchState(summary.watchStatus, summary.percentComplete)}
      // Virtual rows mount only near the viewport, so their posters should not wait to load.
      imageLoading="eager"
    />
  )
  if (edge.node.__typename === 'Movie') {
    return (
      <Link to="/movie/$movieId" params={{ movieId: summary.id }} className={styles.cardLink}>
        {card}
      </Link>
    )
  }
  return (
    <Link to="/series/$seriesId" params={{ seriesId: summary.id }} className={styles.cardLink}>
      {card}
    </Link>
  )
}

// The tvOS library's travel and timings.
const JUMP_TRAVEL = 120
const slideVariants: Variants = {
  idle: { opacity: 1, y: 0, transition: { duration: 0.15 } },
  exit: ({ direction, reduceMotion }: SlideCustom) => {
    const distance = direction === 'forward' ? -JUMP_TRAVEL : JUMP_TRAVEL
    return {
      opacity: 0,
      y: reduceMotion ? 0 : distance,
      transition: { duration: 0.15, ease: 'easeIn' },
    }
  },
  enter: ({ direction, reduceMotion }: SlideCustom) => ({
    opacity: [0, 1],
    y: reduceMotion ? 0 : [direction === 'forward' ? JUMP_TRAVEL : -JUMP_TRAVEL, 0],
    transition: { duration: 0.2, ease: 'easeOut' },
  }),
}
