import { CombinedGraphQLErrors } from '@apollo/client/errors'
import { Alert, Anchor, Center, Loader, Text, Title } from '@mantine/core'
import { useElementScrollRestoration, useLocation } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { Store } from '@tanstack/store'
import { useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import type {
  MediaFilter,
  MediaSort,
  OrderMediaBy,
  SortDirection,
} from '../graphql/generated/graphql'
import { AlphabetRail, type SelectionInput } from '../media/AlphabetRail'
import { formatRelativeTime } from '../media/formatting'
import { FilterBar, type WatchStatusFilter } from './FilterBar'
import { LibraryGrid, type JumpDirection, type LandingRepeat, type SlidePhase } from './LibraryGrid'
import styles from './LibraryScreen.module.css'
import { SortMenu } from './SortMenu'
import { useLibraryItems } from './useLibraryItems'

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

  const locationKey = useLocation({ select: (location) => location.state.__TSR_key })
  const scrollEntry = useElementScrollRestoration({ id: 'library-grid' })
  // Capture only the entry that existed on arrival. The router also records/copies offsets
  // during this visit; those must not turn a fresh letter landing into a restoration.
  const [restoration, setRestoration] = useState({ key: locationKey, y: scrollEntry?.scrollY })
  if (restoration.key !== locationKey) {
    setRestoration({ key: locationKey, y: scrollEntry?.scrollY })
  }
  const restoredScrollY = restoration.key === locationKey ? restoration.y : scrollEntry?.scrollY
  const [repeat, setRepeat] = useState<LandingRepeat>({ request: 0, focus: false })

  // The letter at the top of the grid lives in a store rather than in state, so only the rail,
  // which subscribes to it, re-renders as the viewer scrolls.
  const [visibleLetterStore] = useState(() => new Store<string | null>(null))

  // Keep the old rows visible during the request, then swap them between exit and entry.
  const [jump, setJump] = useState<LetterJump | null>(null)
  const [gridHasLeft, setGridHasLeft] = useState(false)
  // Under reduced motion the grid only fades: the swap is a cut, never a slide.
  const reduceMotion = useReducedMotion() === true
  const jumping = jump !== null && !error
  let slide: SlidePhase = 'idle'
  if (jumping && (staged || gridHasLeft)) slide = 'exit'
  if (jumping && landing && jump.letter === search.letter) slide = 'enter'

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

  function selectLetter(letter: string | null, input: SelectionInput) {
    if (letter && letter === search.letter && search.direction === 'ASC' && landing?.cursor) {
      beginJump(null)
      setRepeat((current) => ({ request: current.request + 1, focus: input === 'keyboard' }))
      return
    }
    const viewedLetter = visibleLetterStore.state ?? search.letter ?? null
    beginJump(
      letter && library
        ? {
            letter,
            direction: directionOfJump(library.alphabetIndex, viewedLetter, letter),
            // Focus travels with a jump made from the keyboard, as it does on tvOS.
            focusLanding: input === 'keyboard',
          }
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
    return <LibraryUnavailable error={error} onRetry={retry} />
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

      {error && <LibraryUnavailable error={error} onRetry={retry} />}

      <div className={styles.body}>
        {edges.length === 0 ? (
          <Text className={styles.empty}>No items match this filter.</Text>
        ) : (
          <LibraryGrid
            edges={edges}
            trackingLetter={trackingLetter}
            hasPreviousPage={hasPreviousPage}
            hasNextPage={hasNextPage}
            loadMore={loadMore}
            loadPrevious={loadPrevious}
            landing={landing}
            locationKey={locationKey}
            restoredScrollY={restoredScrollY}
            repeat={repeat}
            focusLanding={jump?.focusLanding ?? false}
            selectedLetter={search.letter ?? null}
            visibleLetterStore={visibleLetterStore}
            slide={slide}
            direction={jump?.direction}
            reduceMotion={reduceMotion}
            onSlideComplete={(completed) => {
              if (completed === 'exit') setGridHasLeft(true)
              if (completed === 'enter') beginJump(null)
            }}
          />
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
  onSelect: (letter: string | null, input: SelectionInput) => void
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

type LetterJump = { letter: string; direction: JumpDirection; focusLanding: boolean }

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

function LibraryUnavailable({ error, onRetry }: Readonly<{ error: unknown; onRetry: () => void }>) {
  const message = CombinedGraphQLErrors.is(error) ? error.errors[0]?.message : undefined
  return (
    <Alert color="red" role="alert">
      {message || "Couldn't load this library."}{' '}
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
