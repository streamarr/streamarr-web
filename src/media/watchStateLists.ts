import type { ApolloCache } from '@apollo/client'
import {
  ContinueWatchingItemFieldsFragmentDoc,
  HomeDocument,
  type ContinueWatchingItemFieldsFragment,
  type WatchStateChangedSubscription,
} from '../graphql/generated/graphql'
import { evictWatchDependentConnections } from './watchedState'

type WatchStateItem = NonNullable<
  NonNullable<WatchStateChangedSubscription['watchStateChanged']>['items'][number]
>
type ContinueWatchingCandidate = Extract<WatchStateItem, { __typename: 'Movie' | 'Episode' }>
interface LiveLists {
  continueWatching: number
}

/** How many Continue Watching entries Home reads. */
export const CONTINUE_WATCHING_LIMIT = 12
const liveListsByCache = new WeakMap<ApolloCache, LiveLists>()

function liveListsFor(cache: ApolloCache): LiveLists {
  let lists = liveListsByCache.get(cache)
  if (!lists) {
    lists = { continueWatching: 0 }
    liveListsByCache.set(cache, lists)
  }
  return lists
}

/** Keeps Home's Continue Watching current while the caller shows it. Returns the release. */
export function showContinueWatching(cache: ApolloCache): () => void {
  const lists = liveListsFor(cache)
  lists.continueWatching += 1
  return () => {
    lists.continueWatching -= 1
  }
}

/** Updates Continue Watching; library content subscriptions own library membership. */
export function applyWatchStateToLists(cache: ApolloCache, items: readonly WatchStateItem[]) {
  applyToContinueWatching(cache, liveListsFor(cache), items)
  evictWatchDependentConnections(cache)
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
// id. Eligible items stay within the cap; departures shrink it without fetching replacements.
function placeInContinueWatching(
  cache: ApolloCache,
  entries: ContinueWatchingItemFieldsFragment[],
  candidate: ContinueWatchingCandidate,
): ContinueWatchingItemFieldsFragment[] | 'unplaceable' {
  const index = entries.findIndex((entry) => entry.id === candidate.id)
  const others = index < 0 ? entries : entries.toSpliced(index, 1)
  if (candidate.watchStatus !== 'IN_PROGRESS') {
    return others
  }
  const entry = cache.readFragment({
    fragment: ContinueWatchingItemFieldsFragmentDoc,
    fragmentName: 'ContinueWatchingItemFields',
    id: cache.identify(candidate),
  })
  if (!entry) return 'unplaceable'
  const position = positionAmong(others, entry, compareNewestWatchedFirst)
  if (position === index) return entries
  return others.toSpliced(position, 0, entry).slice(0, CONTINUE_WATCHING_LIMIT)
}

type Compare<T> = (a: T, b: T) => number

// The index before the first loaded entry that the item precedes; entries that did not resolve
// keep their places.
function positionAmong<T>(entries: readonly (T | null)[], item: T, compare: Compare<T>): number {
  const index = entries.findIndex((entry) => entry !== null && compare(item, entry) < 0)
  return index < 0 ? entries.length : index
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

function isContinueWatchingCandidate(item: WatchStateItem): item is ContinueWatchingCandidate {
  return item.__typename === 'Movie' || item.__typename === 'Episode'
}
