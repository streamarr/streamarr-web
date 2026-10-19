import { watchingChange } from '../test/continueWatchingFixtures'
import { InMemoryCache } from '@apollo/client'
import { describe, expect, it } from 'vitest'
import possibleTypes from '../graphql/generated/possibleTypes.json'
import {
  HomeDocument,
  WatchStateChangedDocument,
  type WatchStatus,
} from '../graphql/generated/graphql'
import {
  applyWatchStateToLists,
  CONTINUE_WATCHING_LIMIT,
  showContinueWatching,
} from './watchStateLists'

const LIBRARY_ID = 'library-1'

interface Item {
  id: string
  title: string | null
  titleSort?: string | null
  typename?: 'Movie' | 'Series'
  watchStatus?: WatchStatus
  lastWatchedAt?: string | null
  unmatched?: boolean
}

function node(item: Item) {
  const typename = item.typename ?? 'Movie'
  const shared = {
    __typename: typename,
    id: item.id,
    title: item.title,
    titleSort: item.titleSort === undefined ? item.title : item.titleSort,
    watchStatus: item.watchStatus ?? 'UNWATCHED',
    lastWatchedAt: item.lastWatchedAt ?? null,
    watchProgress: null,
    images: [],
  }
  if (typename === 'Series') return { ...shared, firstAirDate: null, seasons: [] }
  return { ...shared, releaseDate: null, runtime: null }
}

function changed(item: Item) {
  return {
    ...node(item),
    unmatched: item.unmatched ?? false,
    library: { __typename: 'Library', id: LIBRARY_ID },
  }
}

function setup() {
  return new InMemoryCache({ possibleTypes: possibleTypes.possibleTypes })
}

function apply(cache: InMemoryCache, items: Item[], { written = true } = {}) {
  const payload = items.map(changed)
  if (written) {
    cache.writeQuery({
      query: WatchStateChangedDocument,
      id: 'ROOT_SUBSCRIPTION',
      data: {
        watchStateChanged: {
          continueWatching: payload.map((item) => watchingChange(item, '10')),
          __typename: 'WatchStateChange',
          items: payload,
        },
      } as never,
    })
  }
  applyWatchStateToLists(cache, payload.map((item) => watchingChange(item, '10')) as never)
}

const started = { watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:00:00Z' } as const

describe('applyWatchStateToLists', () => {
  it('shouldLeaveContinueWatchingWhenAChangeHoldsNoMovieOrEpisode', () => {
    const cache = setup()
    showContinueWatching(cache)

    applyWatchStateToLists(cache, [])

    expect(cache.extract().ROOT_QUERY).toBeUndefined()
  })

  it('shouldLeaveContinueWatchingAloneWhileHomeHasNotLoaded', () => {
    const cache = setup()
    showContinueWatching(cache)

    apply(cache, [{ id: 'a', title: 'Alpha', ...started }])

    expect(
      cache.readQuery({
        query: HomeDocument,
        variables: { continueWatchingFirst: CONTINUE_WATCHING_LIMIT },
      }),
    ).toBeNull()
  })
})
