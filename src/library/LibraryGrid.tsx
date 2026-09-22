import { useMergedRef } from '@mantine/hooks'
import { Link } from '@tanstack/react-router'
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type Virtualizer,
} from '@tanstack/react-virtual'
import type { Store } from '@tanstack/store'
import { motion, type AnimationDefinition, type Variants } from 'motion/react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { flushSync } from 'react-dom'
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
  focusLanding,
  selectedLetter,
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
  focusLanding: boolean
  selectedLetter: string | null
  visibleLetterStore: Store<string | null>
  slide: SlidePhase
  direction: JumpDirection | undefined
  reduceMotion: boolean
  onSlideComplete: (definition: AnimationDefinition) => void
}>) {
  // State lets observers attach to the grid after it mounts; the ref is the handle the layout
  // effects scroll.
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null)
  const gridNodeRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useMergedRef(setGridElement, gridNodeRef)
  const [gridHeight, setGridHeight] = useState(0)
  const frameRef = useRef<HTMLDivElement>(null)
  const probeRowRef = useRef<HTMLDivElement | null>(null)

  const [geometry, setGeometry] = useState(UNMEASURED_ROWS)
  // Focus is the viewer's place in the grid, as on tvOS: the focused card's row stays mounted
  // however far the viewer scrolls, so focus is never lost to the body.
  const [focusedCursor, setFocusedCursor] = useState<string | null>(null)
  const focusedIndex =
    focusedCursor === null ? -1 : edges.findIndex((edge) => edge.cursor === focusedCursor)
  const focusedRow = focusedIndex < 0 ? null : Math.floor(focusedIndex / geometry.columns)
  const cardFocus = useRef<CardFocus>({ cards: new Map(), requested: null })
  // Arrow keys move between cards, Home and End along the row (WAI-ARIA grid).
  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    const target = cardAfterKey(event.key, focusedIndex, geometry.columns, edges.length)
    if (target === null) {
      return
    }
    event.preventDefault()
    const cursor = edges[target].cursor
    cardFocus.current.requested = cursor
    setFocusedCursor(cursor)
  }
  const rowCount = Math.ceil(edges.length / geometry.columns)
  const { virtualizer, rows, totalSize, topRow } = useVirtualRows({
    count: rowCount,
    getScrollElement: () => gridElement,
    estimateSize: () => geometry.rowHeight,
    gap: geometry.rowGap,
    overscan: OVERSCAN_ROWS,
    rangeExtractor: (range) => rowsNearTheViewport(range, focusedRow),
    // Keyed by first title, so a page prepended in whole rows keeps the rows in view mounted.
    getItemKey: (row) => edges[row * geometry.columns]?.cursor ?? row,
  })

  // Measured once rows exist, and again whenever the grid's size changes.
  const measureRows = useEffectEvent(() => {
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
  })
  const hasRows = rows.length > 0
  useLayoutEffect(
    function measureFirstRows() {
      measureRows()
    },
    [hasRows, geometry, virtualizer],
  )
  // A resize observer runs after layout and before paint, so a render flushed inside it re-lays
  // the rows before the frame that resized the grid is painted; a deferred one paints the old
  // rows, wrapped to the new width, for a frame.
  useEffect(
    function relayRowsOnResize() {
      if (!gridElement) {
        return
      }
      const observer = new ResizeObserver(() => {
        flushSync(() => {
          setGridHeight(gridElement.clientHeight)
          measureRows()
        })
      })
      observer.observe(gridElement)
      return () => observer.disconnect()
    },
    [gridElement],
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
  // measured geometry must be ready before restoring a saved position or seeking a letter.
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
      cardFocus.current.requested = focusLanding ? edges[cursorIndex].cursor : null
    },
    [
      landingKey,
      landingCursor,
      focusLanding,
      gridElement,
      geometry,
      edges,
      virtualizer,
      locationKey,
      restoredScrollY,
      repeatLanding,
    ],
  )

  // A card asked to take focus does so in the first render that mounts it: after a landing, its
  // row renders only once the grid has scrolled there, and a card focused when its row is
  // re-keyed returns in a new element. This runs after the effects above have placed the rows,
  // so focusing scrolls nothing they have already put in view.
  useLayoutEffect(function focusRequestedCard() {
    const { cards, requested } = cardFocus.current
    const card = requested === null ? undefined : cards.get(requested)
    if (!card) {
      return
    }
    cardFocus.current.requested = null
    card.focus()
  })

  // The rail follows the row at the top of the grid; only the rail subscribes to the store. A
  // row where the chosen letter begins still belongs to the letter before it on the left, and
  // the rail shows the letter the viewer asked for, as tvOS does through the focused title.
  const topLetter = trackingLetter
    ? letterAtTheTop(
        edges.slice(topRow * geometry.columns, (topRow + 1) * geometry.columns),
        selectedLetter,
      )
    : null
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
  // One tab stop: the focused card, else the first card in view.
  const tabStopIndex = focusedIndex < 0 ? topRow * geometry.columns : focusedIndex
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
        <div
          role="grid"
          aria-label="Items"
          aria-rowcount={rowCount}
          className={styles.rows}
          style={{ height: totalSize }}
          onKeyDown={moveFocus}
        >
          {hasPreviousPage && (
            <div ref={loadPreviousRef} aria-hidden className={styles.sentinel} data-edge="start" />
          )}
          {rows.map((row) => {
            const first = row.index * geometry.columns
            return (
              <div
                key={row.key}
                role="row"
                aria-rowindex={row.index + 1}
                data-index={row.index}
                ref={row.index === probeRowIndex ? probeRowRef : undefined}
                className={styles.row}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {edges.slice(first, first + geometry.columns).map((edge, column) => (
                  <LibraryCard
                    key={edge.cursor}
                    edge={edge}
                    tabStop={first + column === tabStopIndex}
                    focus={cardFocus}
                    onFocus={setFocusedCursor}
                  />
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

function rowsNearTheViewport(range: Range, focusedRow: number | null) {
  const rows = defaultRangeExtractor(range)
  if (focusedRow === null || focusedRow >= range.count || rows.includes(focusedRow)) {
    return rows
  }
  return [...rows, focusedRow].sort((a, b) => a - b)
}

function letterAtTheTop(topRow: LibraryEdge[], selectedLetter: string | null) {
  const letters = topRow.map((edge) => summaryLetter(summarizeMedia(edge.node)))
  if (selectedLetter && letters.includes(selectedLetter)) {
    return selectedLetter
  }
  return letters[0] ?? null
}

function rowStart(virtualizer: Virtualizer<HTMLDivElement, Element>, row: number) {
  return virtualizer.measurementsCache[row]?.start ?? 0
}

// A cell is measured rather than the row: as the grid narrows, a row laid out for more columns
// wraps its cards for a moment, and its height is then that of several rows.
function measureRowGeometry(row: HTMLElement): RowGeometry | null {
  const rowHeight = Math.ceil(row.firstElementChild?.getBoundingClientRect().height ?? 0)
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

function cardAfterKey(key: string, index: number, columns: number, count: number) {
  if (index < 0) {
    return null
  }
  const rowStart = index - (index % columns)
  const moves: Record<string, number> = {
    ArrowRight: index + 1,
    ArrowLeft: index - 1,
    ArrowDown: index + columns,
    ArrowUp: index - columns,
    Home: rowStart,
    End: Math.min(rowStart + columns - 1, count - 1),
  }
  const target = moves[key]
  if (target === undefined || target === index || target < 0 || target >= count) {
    return null
  }
  return target
}

// The rendered cards by cursor, and the cursor of a card asked to take focus once rendered.
type CardFocus = { cards: Map<string, HTMLAnchorElement>; requested: string | null }

function LibraryCard({
  edge,
  tabStop,
  focus,
  onFocus,
}: Readonly<{
  edge: LibraryEdge
  tabStop: boolean
  focus: RefObject<CardFocus>
  onFocus: (cursor: string) => void
}>) {
  const summary = summarizeMedia(edge.node)
  // One identity for the card's life: React re-runs a changed ref's cleanup on the mounted node,
  // which would read as the card unmounting whenever the tab stop moved.
  const registerCard = useCallback(
    (node: HTMLAnchorElement | null) => {
      if (!node) {
        return
      }
      focus.current.cards.set(edge.cursor, node)
      return () => {
        focus.current.cards.delete(edge.cursor)
        // Unmounted while focused: the row was re-keyed, and the card returns in a new element.
        if (document.activeElement === node) {
          focus.current.requested = edge.cursor
        }
      }
    },
    [edge.cursor, focus],
  )
  const linkProps = {
    className: styles.cardLink,
    tabIndex: tabStop ? 0 : -1,
    onFocus: () => onFocus(edge.cursor),
    ref: registerCard,
  }
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
  return (
    <div role="gridcell">
      {edge.node.__typename === 'Movie' ? (
        <Link to="/movie/$movieId" params={{ movieId: summary.id }} {...linkProps}>
          {card}
        </Link>
      ) : (
        <Link to="/series/$seriesId" params={{ seriesId: summary.id }} {...linkProps}>
          {card}
        </Link>
      )}
    </div>
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
