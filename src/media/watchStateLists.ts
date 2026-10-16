import type { ApolloCache } from '@apollo/client'
import {
  ContinueWatchingItemFieldsFragmentDoc,
  HomeDocument,
  LibraryPageDocument,
  MediaSummaryFieldsFragmentDoc,
  type ContinueWatchingItemFieldsFragment,
  type LibraryPageQuery,
  type MediaFilter,
  type MediaSort,
  type WatchStateChangedSubscription,
} from '../graphql/generated/graphql'
import { alphabetLetterFromTitle } from './alphabetLetter'
import { evictWatchDependentConnections, type LibraryItemsConnection } from './watchedState'

type WatchStateItem = NonNullable<
  NonNullable<WatchStateChangedSubscription['watchStateChanged']>['items'][number]
>
type LibraryItem = Extract<WatchStateItem, { __typename: 'Movie' | 'Series' }>
type ContinueWatchingCandidate = Extract<WatchStateItem, { __typename: 'Movie' | 'Episode' }>
type LibraryItems = LibraryPageQuery['library']['items']
type LoadedEdges = NonNullable<LibraryItems['edges']>
type LibraryEdge = NonNullable<LoadedEdges[number]>
type LibraryNode = NonNullable<LibraryEdge['node']>

interface LiveLists {
  continueWatching: number
  libraryItems: Map<string, { connection: LibraryItemsConnection; count: number }>
}

const LOCAL_CURSOR_PREFIX = 'local:'

/** How many Continue Watching entries Home reads. */
export const CONTINUE_WATCHING_LIMIT = 12
const liveListsByCache = new WeakMap<ApolloCache, LiveLists>()

function liveListsFor(cache: ApolloCache): LiveLists {
  let lists = liveListsByCache.get(cache)
  if (!lists) {
    lists = { continueWatching: 0, libraryItems: new Map() }
    liveListsByCache.set(cache, lists)
  }
  return lists
}

/**
 * Whether a cursor names an item that a watch-state change placed in a loaded library view. Such
 * a cursor is no position on the server, so it never anchors a page request or a letter landing.
 */
export function isLocalCursor(cursor: string): boolean {
  return cursor.startsWith(LOCAL_CURSOR_PREFIX)
}

/** Keeps Home's Continue Watching current while the caller shows it. Returns the release. */
export function showContinueWatching(cache: ApolloCache): () => void {
  const lists = liveListsFor(cache)
  lists.continueWatching += 1
  return () => {
    lists.continueWatching -= 1
  }
}

/** Keeps one loaded library view current while the caller shows it. Returns the release. */
export function showLibraryItems(
  cache: ApolloCache,
  connection: LibraryItemsConnection,
): () => void {
  const lists = liveListsFor(cache)
  const key = JSON.stringify(connection)
  const shown = lists.libraryItems.get(key) ?? { connection, count: 0 }
  shown.count += 1
  lists.libraryItems.set(key, shown)
  return () => {
    shown.count -= 1
    if (shown.count === 0) lists.libraryItems.delete(key)
  }
}

/**
 * Applies watch-state items that the cache already holds to the lists they belong in, by the
 * rules of the server's queries. Each shown list changes in place. A watch-dependent list that
 * nobody shows is evicted, so the next visit reads it again. A list that cannot place an item
 * from what the cache holds is evicted too, and reads again while it is shown.
 */
export function applyWatchStateToLists(cache: ApolloCache, items: readonly WatchStateItem[]) {
  const lists = liveListsFor(cache)
  applyToContinueWatching(cache, lists, items)
  for (const { connection } of lists.libraryItems.values()) {
    if (!isWatchDependent(connection)) continue
    if (applyToLibraryView(cache, connection, items) === 'unplaceable') {
      evictLibraryView(cache, connection)
    }
  }
  evictWatchDependentConnections(cache, (connection) =>
    lists.libraryItems.has(JSON.stringify(connection)),
  )
}

function applyToContinueWatching(
  cache: ApolloCache,
  lists: LiveLists,
  items: readonly WatchStateItem[],
) {
  const candidates = items.filter(isContinueWatchingCandidate)
  if (candidates.length === 0) return
  if (lists.continueWatching === 0) {
    cache.evict({ fieldName: 'continueWatching' })
    return
  }
  let unplaceable = false
  const variables = { continueWatchingFirst: CONTINUE_WATCHING_LIMIT }
  cache.updateQuery({ query: HomeDocument, variables }, (data) => {
    if (!data) return undefined
    let entries = data.continueWatching
    for (const candidate of candidates) {
      const placed = placeInContinueWatching(cache, entries, candidate)
      if (placed === 'unplaceable') {
        unplaceable = true
        continue
      }
      entries = placed
    }
    return entries === data.continueWatching ? undefined : { ...data, continueWatching: entries }
  })
  if (unplaceable) cache.evict({ fieldName: 'continueWatching' })
}

// Continue Watching holds each movie and episode in progress, newest last watched first, then by
// id. A full list may stop short of the server's: an entry that leaves it, or moves past its last
// entry, leaves a place that only the server can fill.
function placeInContinueWatching(
  cache: ApolloCache,
  entries: ContinueWatchingItemFieldsFragment[],
  candidate: ContinueWatchingCandidate,
): ContinueWatchingItemFieldsFragment[] | 'unplaceable' {
  const index = entries.findIndex((entry) => entry.id === candidate.id)
  const full = entries.length >= CONTINUE_WATCHING_LIMIT
  const others = index < 0 ? entries : entries.toSpliced(index, 1)
  if (candidate.watchStatus !== 'IN_PROGRESS') {
    return index >= 0 && full ? 'unplaceable' : others
  }
  const entry = cache.readFragment({
    fragment: ContinueWatchingItemFieldsFragmentDoc,
    fragmentName: 'ContinueWatchingItemFields',
    id: cache.identify(candidate),
  })
  if (!entry) return 'unplaceable'
  const position = positionAmong(others, entry, compareNewestWatchedFirst)
  if (position === index) return entries
  if (position === others.length && full) return index < 0 ? entries : 'unplaceable'
  return others.toSpliced(position, 0, entry).slice(0, CONTINUE_WATCHING_LIMIT)
}

function applyToLibraryView(
  cache: ApolloCache,
  connection: LibraryItemsConnection,
  items: readonly WatchStateItem[],
): 'placed' | 'unplaceable' {
  const { libraryId, args } = connection
  let unplaceable = false
  cache.updateQuery({ query: LibraryPageDocument, variables: { libraryId, ...args } }, (data) => {
    if (!data) return undefined
    const loaded = data.library.items
    let edges = loaded.edges ?? []
    for (const item of items) {
      if (!isLibraryItem(item) || item.library.id !== libraryId) continue
      const placed = placeInLibraryView(cache, { edges, pageInfo: loaded.pageInfo }, args, item)
      if (placed === 'unplaceable') {
        unplaceable = true
        continue
      }
      edges = placed
    }
    if (edges === loaded.edges) return undefined
    return { ...data, library: { ...data.library, items: { ...loaded, edges } } }
  })
  return unplaceable ? 'unplaceable' : 'placed'
}

// A filtered view takes in an item that now matches its watched-status filter, and a LAST_WATCHED
// view moves an item whose last watched changed. Either places the item only inside the loaded
// pages; an item that belongs before or past them is left for pagination.
function placeInLibraryView(
  cache: ApolloCache,
  { edges, pageInfo }: { edges: LoadedEdges; pageInfo: LibraryItems['pageInfo'] },
  { sort, filter }: LibraryItemsConnection['args'],
  item: LibraryItem,
): LoadedEdges | 'unplaceable' {
  const index = edges.findIndex((edge) => edge?.node?.id === item.id)
  const loadedEdge = edges[index]
  const others = loadedEdge ? edges.toSpliced(index, 1) : edges
  if (!matchesKnownCriteria(item, sort, filter)) return others
  if (loadedEdge && sort.by !== 'LAST_WATCHED') return edges
  if (!loadedEdge && item.unmatched) return edges
  const compare = comparatorFor(sort)
  if (!compare || hasUnknownCriteria(filter)) return 'unplaceable'
  const edge = loadedEdge ?? localEdge(cache, item)
  if (!edge?.node) return 'unplaceable'
  const nodes = others.map((each) => each?.node ?? null)
  const position = positionAmong(nodes, edge.node, compare)
  if (position === index) return edges
  const insideLoadedRange =
    (position > 0 || !pageInfo.hasPreviousPage) &&
    (position < others.length || !pageInfo.hasNextPage)
  return insideLoadedRange ? others.toSpliced(position, 0, edge) : others
}

function localEdge(cache: ApolloCache, item: LibraryItem): LibraryEdge | null {
  const node = cache.readFragment({
    fragment: MediaSummaryFieldsFragmentDoc,
    fragmentName: 'MediaSummaryFields',
    id: cache.identify(item),
  })
  return node ? { cursor: `${LOCAL_CURSOR_PREFIX}${item.id}`, node } : null
}

// The criteria a change can be checked against. Under TITLE sort, the start letter only marks
// where the view began, so it does not restrict membership.
function matchesKnownCriteria(item: LibraryItem, sort: MediaSort, filter: MediaFilter): boolean {
  if (filter.watchStatus && item.watchStatus !== filter.watchStatus) return false
  if (filter.unmatched != null && item.unmatched !== filter.unmatched) return false
  if (!filter.startLetter || isTitleSort(sort)) return true
  return alphabetLetterFromTitle(item.titleSort ?? item.title ?? '') === filter.startLetter
}

function hasUnknownCriteria(filter: MediaFilter): boolean {
  const { genreIds, years, contentRatings, studioIds, directorIds, castMemberIds } = filter
  return [genreIds, years, contentRatings, studioIds, directorIds, castMemberIds].some(
    (values) => (values?.length ?? 0) > 0,
  )
}

function isWatchDependent({ args }: LibraryItemsConnection): boolean {
  return !!args.filter.watchStatus || args.sort.by === 'LAST_WATCHED'
}

function evictLibraryView(cache: ApolloCache, { libraryId, args }: LibraryItemsConnection) {
  cache.evict({
    id: cache.identify({ __typename: 'Library', id: libraryId }),
    fieldName: 'items',
    args,
  })
}

type Compare<T> = (a: T, b: T) => number

// The index before the first loaded entry that the item precedes; entries that did not resolve
// keep their places.
function positionAmong<T>(entries: readonly (T | null)[], item: T, compare: Compare<T>): number {
  const index = entries.findIndex((entry) => entry !== null && compare(item, entry) < 0)
  return index < 0 ? entries.length : index
}

// The server's order: TITLE by the lower-cased sort title, LAST_WATCHED by last watched with
// never-watched items last in both directions, each then by id in the same direction.
function comparatorFor(sort: MediaSort): Compare<LibraryNode> | null {
  const direction = sort.direction === 'DESC' ? -1 : 1
  if (isTitleSort(sort)) {
    return (a, b) => direction * (compareText(titleKey(a), titleKey(b)) || compareText(a.id, b.id))
  }
  if (sort.by === 'LAST_WATCHED') {
    return (a, b) =>
      compareNeverWatchedLast(a.lastWatchedAt, b.lastWatchedAt) ||
      direction * (compareTimes(a.lastWatchedAt, b.lastWatchedAt) || compareText(a.id, b.id))
  }
  return null
}

function compareNewestWatchedFirst(
  a: ContinueWatchingItemFieldsFragment,
  b: ContinueWatchingItemFieldsFragment,
): number {
  return (
    compareNeverWatchedLast(a.lastWatchedAt, b.lastWatchedAt) ||
    -(compareTimes(a.lastWatchedAt, b.lastWatchedAt) || compareText(a.id, b.id))
  )
}

function isTitleSort(sort: MediaSort): boolean {
  return (sort.by ?? 'TITLE') === 'TITLE'
}

function titleKey(node: LibraryNode): string {
  return (node.titleSort ?? node.title ?? '').toLowerCase()
}

function compareNeverWatchedLast(a: string | null, b: string | null): number {
  return Number(a === null) - Number(b === null)
}

function compareTimes(a: string | null, b: string | null): number {
  if (a === null || b === null) return 0
  return Date.parse(a) - Date.parse(b)
}

function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function isLibraryItem(item: WatchStateItem): item is LibraryItem {
  return item.__typename === 'Movie' || item.__typename === 'Series'
}

function isContinueWatchingCandidate(item: WatchStateItem): item is ContinueWatchingCandidate {
  return item.__typename === 'Movie' || item.__typename === 'Episode'
}
