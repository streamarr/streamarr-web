import { Center, Loader } from '@mantine/core'
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
// A request to land on the current letter again, and whether focus travels with it.
export type LandingRepeat = { request: number; focus: boolean }
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
  firstPosition,
  trackingLetter,
  hasPreviousPage,
  hasNextPage,
  loadMore,
  loadPrevious,
  unloadFarFrom,
  landing,
  locationKey,
  restoredScrollY,
  repeat,
  focusLanding,
  selectedLetter,
  visibleLetterStore,
  slide,
  direction,
  reduceMotion,
  onSlideComplete,
  onColumnsChange,
}: Readonly<{
  edges: LibraryItems['edges']
  firstPosition: LibraryItems['firstPosition']
  trackingLetter: boolean
  hasPreviousPage: boolean
  hasNextPage: boolean
  loadMore: LibraryItems['loadMore']
  loadPrevious: LibraryItems['loadPrevious']
  unloadFarFrom: LibraryItems['unloadFarFrom']
  locationKey: string | undefined
  restoredScrollY: number | undefined
  repeat: LandingRepeat
  landing: LibraryItems['landing']
  focusLanding: boolean
  selectedLetter: string | null
  visibleLetterStore: Store<string | null>
  slide: SlidePhase
  direction: JumpDirection | undefined
  reduceMotion: boolean
  onSlideComplete: (definition: AnimationDefinition) => void
  onColumnsChange: (columns: number) => void
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
  const layout = rowLayout(geometry.columns, firstPosition)
  // Focus is the viewer's place in the grid, as on tvOS: the focused card's row stays mounted
  // however far the viewer scrolls, so focus is never lost to the body.
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null)
  const focusedIndex =
    focusedItemId === null ? -1 : edges.findIndex((edge) => edge.node.id === focusedItemId)
  const focusedRow = focusedIndex < 0 ? null : layout.rowOf(focusedIndex)
  const cardFocus = useRef<CardFocus>({ cards: new Map(), requested: null })
  // Arrow keys move between cards, Home and End along the row (WAI-ARIA grid).
  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    const target = cardAfterKey({
      key: event.key,
      index: focusedIndex,
      entry: tabStopIndex,
      columns: geometry.columns,
      lead: layout.lead,
      count: edges.length,
    })
    if (target === null) {
      return
    }
    // The grid owns these keys even at an edge; the browser would otherwise scroll on them.
    event.preventDefault()
    if (target === focusedIndex) {
      return
    }
    const itemId = edges[target].node.id
    cardFocus.current.requested = itemId
    setFocusedItemId(itemId)
  }
  const rowCount = layout.rowOf(edges.length - 1) + 1
  const { virtualizer, rows, totalSize, topRow, bottomRow } = useVirtualRows({
    count: rowCount,
    getScrollElement: () => gridElement,
    estimateSize: () => geometry.rowHeight,
    gap: geometry.rowGap,
    overscan: OVERSCAN_ROWS,
    rangeExtractor: (range) => rowsNearTheViewport(range, focusedRow),
    // Keyed by first title, so a page prepended in whole rows keeps the rows in view mounted.
    getItemKey: (row) => edges[layout.firstIndexOf(row)]?.node.id ?? row,
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
    onColumnsChange(next.columns)
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

  // The titles in view keep the titles near them loaded, as does the focused card wherever it is.
  const unloadTitlesFarFromView = useEffectEvent(() => {
    if (!geometry.measured || edges.length === 0) {
      return
    }
    const first = layout.firstIndexOf(topRow)
    const last = Math.min(edges.length, layout.firstIndexOf(bottomRow + 1)) - 1
    if (focusedIndex < 0) {
      unloadFarFrom({ first, last })
      return
    }
    unloadFarFrom({ first: Math.min(first, focusedIndex), last: Math.max(last, focusedIndex) })
  })
  useEffect(
    function unloadFarTitlesAsTheViewMoves() {
      unloadTitlesFarFromView()
    },
    [topRow, bottomRow, edges.length],
  )

  // Rows prepended or unloaded above move every row by whole rows; the viewer's rows stay put.
  // Only within one result: another query's rows may repeat a title without having grown above it.
  const firstItemId = edges[0]?.node.id
  const previousFirstRef = useRef({ key: landingKey, itemId: firstItemId, edges, firstPosition })
  useLayoutEffect(
    function keepRowsInPlaceWhenRowsAboveChange() {
      const previous = previousFirstRef.current
      previousFirstRef.current = { key: landingKey, itemId: firstItemId, edges, firstPosition }
      const grid = gridNodeRef.current
      if (!grid || previous.key !== landingKey || previous.itemId === firstItemId) {
        return
      }
      const prepended = edges.findIndex((edge) => edge.node.id === previous.itemId)
      if (prepended > 0) {
        grid.scrollTop += rowStart(virtualizer, layout.rowOf(prepended))
        return
      }
      const unloaded = previous.edges.findIndex((edge) => edge.node.id === firstItemId)
      if (prepended < 0 && unloaded > 0) {
        const rows = rowLayout(geometry.columns, previous.firstPosition).rowOf(unloaded)
        // The browser has already clamped scrollTop to the shorter rows; the virtualizer still
        // holds the offset the viewer scrolled to.
        const offset = virtualizer.scrollOffset ?? grid.scrollTop
        grid.scrollTop = offset - rows * (geometry.rowHeight + geometry.rowGap)
      }
    },
    [landingKey, firstItemId, edges, firstPosition, gridElement, geometry, layout, virtualizer],
  )

  // Before paint, once per result: later pages merge into the same result without moving it.
  // Measured geometry must be ready before restoring a saved position or seeking a letter.
  const placedResult = useRef<{
    locationKey: string | undefined
    landingKey: string
    repeat: number
  } | null>(null)
  useLayoutEffect(
    function placeLandingRow() {
      const grid = gridNodeRef.current
      if (
        landingKey === undefined ||
        !grid ||
        (placedResult.current?.locationKey === locationKey &&
          placedResult.current?.landingKey === landingKey &&
          placedResult.current?.repeat === repeat.request)
      ) {
        return
      }
      if (!geometry.measured) {
        return
      }
      const repeated =
        placedResult.current !== null && placedResult.current.repeat !== repeat.request
      placedResult.current = { locationKey, landingKey, repeat: repeat.request }
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
      grid.scrollTop = rowStart(virtualizer, layout.rowOf(cursorIndex))
      // A short page scrolls to the letter's row, through the frame the slide cannot move.
      frameRef.current?.scrollIntoView({ block: 'start' })
      const focus = repeated ? repeat.focus : focusLanding
      cardFocus.current.requested = focus ? edges[cursorIndex].node.id : null
    },
    [
      landingKey,
      landingCursor,
      focusLanding,
      gridElement,
      geometry,
      layout,
      edges,
      virtualizer,
      locationKey,
      restoredScrollY,
      repeat,
    ],
  )

  // A card asked to take focus does so in the first render that mounts it: after a landing, its
  // row renders only once the grid has scrolled there, and a card focused when its row is
  // re-keyed returns in a new element. This runs after the effects above have placed the rows,
  // so focusing scrolls nothing they have already put in view.
  useLayoutEffect(function focusRequestedCard() {
    const { cards, requested } = cardFocus.current
    if (requested === null) {
      return
    }
    const card = cards.get(requested)
    if (card) {
      cardFocus.current.requested = null
      card.focus()
      return
    }
    // A card that left with its result will never mount again; its request must not stand in
    // for the next card unmounted while focused.
    if (!edges.some((edge) => edge.node.id === requested)) {
      cardFocus.current.requested = null
    }
  })

  // The rail follows the row at the top of the grid; only the rail subscribes to the store. A
  // row where the chosen letter begins still belongs to the letter before it on the left, and
  // the rail shows the letter the viewer asked for, as tvOS does through the focused title.
  const topLetter = trackingLetter
    ? letterAtTheTop(
        edges.slice(layout.firstIndexOf(topRow), layout.firstIndexOf(topRow + 1)),
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
  const tabStopIndex = focusedIndex < 0 ? layout.firstIndexOf(topRow) : focusedIndex
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
          // The loaded titles are a window on the library; its size is unknown here (ARIA: -1).
          aria-rowcount={-1}
          // Focusable by a click on the space between cards, so the keys keep moving their focus.
          tabIndex={-1}
          className={styles.rows}
          style={{ height: totalSize }}
          onKeyDown={moveFocus}
        >
          {hasPreviousPage && (
            <div ref={loadPreviousRef} aria-hidden className={styles.sentinel} data-edge="start" />
          )}
          {rows.map((row) => {
            const first = layout.firstIndexOf(row.index)
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
                {edges.slice(first, layout.firstIndexOf(row.index + 1)).map((edge, column) => (
                  <LibraryCard
                    key={edge.node.id}
                    edge={edge}
                    startColumn={
                      first + column === 0 && layout.lead > 0 ? layout.lead + 1 : undefined
                    }
                    tabStop={first + column === tabStopIndex}
                    focus={cardFocus}
                    onFocus={setFocusedItemId}
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

/** Holds the grid's place while its first titles load, and counts the columns they will fill. */
export function LibraryGridPlaceholder({
  onColumnsChange,
}: Readonly<{ onColumnsChange: (columns: number) => void }>) {
  const probeRowRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(
    function countColumnsBeforeTheFirstPage() {
      if (probeRowRef.current) onColumnsChange(countColumns(probeRowRef.current))
    },
    [onColumnsChange],
  )
  return (
    <div className={styles.gridFrame}>
      <div className={styles.grid}>
        <Center h={200}>
          <Loader />
        </Center>
        {/* An empty auto-fill row has as many tracks as a full one. */}
        <div className={styles.rows}>
          <div ref={probeRowRef} className={styles.row} />
        </div>
      </div>
    </div>
  )
}

// The React Compiler skips any function that calls useVirtualizer, whose instance keeps one
// identity while its range changes; kept apart so the grid itself still compiles.
function useVirtualRows(options: Parameters<typeof useVirtualizer<HTMLDivElement, Element>>[0]) {
  'use no memo'
  // This uncompiled adapter reads fresh snapshots from the virtualizer's mutable instance.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer(options)
  return {
    virtualizer,
    rows: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    topRow: virtualizer.range?.startIndex ?? 0,
    bottomRow: virtualizer.range?.endIndex ?? 0,
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

// Rows break where a title's library position is a multiple of the column count, so the first
// loaded row starts `lead` cells in until the titles before it have loaded.
function rowLayout(columns: number, firstPosition: number) {
  const lead = firstPosition % columns
  return {
    lead,
    rowOf: (index: number) => Math.floor((index + lead) / columns),
    firstIndexOf: (row: number) => Math.max(0, row * columns - lead),
  }
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
  return {
    columns: countColumns(row),
    rowHeight,
    rowGap: Number.parseFloat(getComputedStyle(row).rowGap) || 0,
    measured: true,
  }
}

function countColumns(row: HTMLElement) {
  const tracks = getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean).length
  return Math.max(1, tracks)
}

function sameGeometry(a: RowGeometry, b: RowGeometry) {
  return a.columns === b.columns && a.rowHeight === b.rowHeight && a.rowGap === b.rowGap
}

// The card a navigation key lands on: the entry card while none is focused, the same card at an
// edge, null for any other key.
function cardAfterKey({
  key,
  index,
  entry,
  columns,
  lead,
  count,
}: {
  key: string
  index: number
  entry: number
  columns: number
  lead: number
  count: number
}) {
  const rowStart = index - ((index + lead) % columns)
  const moves: Record<string, number> = {
    ArrowRight: index + 1,
    ArrowLeft: index - 1,
    ArrowDown: index + columns,
    ArrowUp: index - columns,
    Home: Math.max(0, rowStart),
    End: Math.min(rowStart + columns - 1, count - 1),
  }
  const target = moves[key]
  if (target === undefined) {
    return null
  }
  if (index < 0) {
    return entry
  }
  return target < 0 || target >= count ? index : target
}

// The rendered cards by item ID, and the item asked to take focus once rendered.
type CardFocus = { cards: Map<string, HTMLAnchorElement>; requested: string | null }

function LibraryCard({
  edge,
  startColumn,
  tabStop,
  focus,
  onFocus,
}: Readonly<{
  edge: LibraryEdge
  startColumn: number | undefined
  tabStop: boolean
  focus: RefObject<CardFocus>
  onFocus: (itemId: string) => void
}>) {
  const summary = summarizeMedia(edge.node)
  // One identity for the card's life: React re-runs a changed ref's cleanup on the mounted node,
  // which would read as the card unmounting whenever the tab stop moved.
  const registerCard = useCallback(
    (node: HTMLAnchorElement | null) => {
      if (!node) {
        return
      }
      focus.current.cards.set(edge.node.id, node)
      return () => {
        focus.current.cards.delete(edge.node.id)
        // Unmounted while focused: the row was re-keyed, and the card returns in a new element.
        // Unless focus is already on its way elsewhere, as when a key moved it off this row.
        if (document.activeElement === node && focus.current.requested === null) {
          focus.current.requested = edge.node.id
        }
      }
    },
    [edge.node.id, focus],
  )
  const linkProps = {
    className: styles.cardLink,
    tabIndex: tabStop ? 0 : -1,
    onFocus: () => onFocus(edge.node.id),
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
    <div role="gridcell" style={{ gridColumnStart: startColumn }}>
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
