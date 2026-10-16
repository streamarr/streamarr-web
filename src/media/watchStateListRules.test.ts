import { InMemoryCache } from '@apollo/client'
import { describe, expect, it } from 'vitest'
import possibleTypes from '../graphql/generated/possibleTypes.json'
import {
  HomeDocument,
  LibraryPageDocument,
  WatchStateChangedDocument,
  type MediaFilter,
  type MediaSort,
  type WatchStatus,
} from '../graphql/generated/graphql'
import {
  applyWatchStateToLists,
  CONTINUE_WATCHING_LIMIT,
  showContinueWatching,
  showLibraryItems,
} from './watchStateLists'

const LIBRARY_ID = 'library-1'
const TITLE_ASC: MediaSort = { by: 'TITLE', direction: 'ASC' }
const LAST_WATCHED_ASC: MediaSort = { by: 'LAST_WATCHED', direction: 'ASC' }

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

function viewArgs(sort: MediaSort, filter: MediaFilter) {
  return { first: 48, sort, filter }
}

// Writes a loaded library view and shows it, as a mounted library screen does.
function showView(
  cache: InMemoryCache,
  {
    sort = TITLE_ASC,
    filter = { watchStatus: 'IN_PROGRESS' },
    items,
    hasNextPage = false,
    hasPreviousPage = false,
  }: {
    sort?: MediaSort
    filter?: MediaFilter
    items: Item[] | null
    hasNextPage?: boolean
    hasPreviousPage?: boolean
  },
) {
  const args = viewArgs(sort, filter)
  cache.writeQuery({
    query: LibraryPageDocument,
    variables: { libraryId: LIBRARY_ID, ...args },
    data: {
      library: {
        __typename: 'Library',
        id: LIBRARY_ID,
        name: 'Movies',
        status: 'HEALTHY',
        scanCompletedOn: null,
        alphabetIndex: [],
        items: {
          __typename: 'MediaConnection',
          edges:
            items?.map((item) => ({
              __typename: 'MediaEdge',
              cursor: item.id,
              node: node(item),
            })) ?? null,
          pageInfo: {
            __typename: 'PageInfo',
            hasNextPage,
            hasPreviousPage,
            startCursor: null,
            endCursor: null,
          },
        },
      },
    } as never,
  })
  const release = showLibraryItems(cache, { libraryId: LIBRARY_ID, args })
  const shown = () =>
    cache
      .readQuery({ query: LibraryPageDocument, variables: { libraryId: LIBRARY_ID, ...args } })
      ?.library.items.edges?.map((edge) => edge?.node?.id ?? null) ?? null
  return { shown, release }
}

function apply(cache: InMemoryCache, items: Item[], { written = true } = {}) {
  const payload = items.map(changed)
  if (written) {
    cache.writeQuery({
      query: WatchStateChangedDocument,
      id: 'ROOT_SUBSCRIPTION',
      data: { watchStateChanged: { __typename: 'WatchStateChange', items: payload } } as never,
    })
  }
  applyWatchStateToLists(cache, payload as never)
}

const started = { watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:00:00Z' } as const

describe('applyWatchStateToLists', () => {
  it('shouldReadAViewAgainWhenItsSortCannotPlaceAnItem', () => {
    const cache = setup()
    const { shown } = showView(cache, {
      sort: { by: 'ADDED', direction: 'DESC' },
      items: [{ id: 'a', title: 'Alpha', ...started }],
    })

    apply(cache, [{ id: 'b', title: 'Bravo', ...started }])

    expect(shown()).toBeNull()
  })

  it('shouldReadAViewAgainWhenItsFilterHasCriteriaAChangeCannotCheck', () => {
    const cache = setup()
    const { shown } = showView(cache, {
      filter: { watchStatus: 'IN_PROGRESS', genreIds: ['drama'] },
      items: [{ id: 'a', title: 'Alpha', ...started }],
    })

    apply(cache, [{ id: 'b', title: 'Bravo', ...started }])

    expect(shown()).toBeNull()
  })

  it('shouldReadAViewAgainWhenTheCacheCannotBuildTheItemsCard', () => {
    const cache = setup()
    const { shown } = showView(cache, { items: [{ id: 'a', title: 'Alpha', ...started }] })

    apply(cache, [{ id: 'b', title: 'Bravo', ...started }], { written: false })

    expect(shown()).toBeNull()
  })

  it('shouldDropAnItemThatNoLongerMatchesTheUnmatchedFilter', () => {
    const cache = setup()
    const { shown } = showView(cache, {
      filter: { watchStatus: 'IN_PROGRESS', unmatched: true },
      items: [
        { id: 'a', title: 'Alpha', ...started },
        { id: 'b', title: 'Bravo', ...started },
      ],
    })

    apply(cache, [{ id: 'a', title: 'Alpha', ...started, unmatched: false }])

    expect(shown()).toEqual(['b'])
  })

  it('shouldPlaceASeriesByItsStartLetterUnderLastWatchedOrder', () => {
    const cache = setup()
    const { shown } = showView(cache, {
      sort: LAST_WATCHED_ASC,
      filter: { startLetter: 'B' },
      items: [
        { id: 'b1', title: 'Bravo', watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T08:00:00Z' },
      ],
    })

    apply(cache, [
      { id: 'b2', title: 'Brook', typename: 'Series', ...started },
      { id: 'c1', title: 'Charlie', typename: 'Series', ...started },
    ])

    expect(shown()).toEqual(['b1', 'b2'])
  })

  it('shouldOrderNeverWatchedItemsLastByIdThenEqualTitlesById', () => {
    const cache = setup()
    const lastWatched = showView(cache, {
      sort: LAST_WATCHED_ASC,
      filter: {},
      items: [
        { id: 'a', title: 'Alpha', lastWatchedAt: '2026-10-16T08:00:00Z' },
        { id: 'c', title: 'Charlie' },
      ],
    })
    const byTitleDescending = showView(cache, {
      sort: { by: 'TITLE', direction: 'DESC' },
      filter: { watchStatus: 'UNWATCHED' },
      items: [
        { id: 'z', title: 'Same' },
        { id: 'x', title: null, titleSort: null },
      ],
    })

    apply(cache, [
      { id: 'b', title: 'Bravo', watchStatus: 'UNWATCHED', lastWatchedAt: null },
      { id: 'y', title: 'Same', watchStatus: 'UNWATCHED' },
    ])

    expect(lastWatched.shown()).toEqual(['a', 'b', 'c', 'y'])
    expect(byTitleDescending.shown()).toEqual(['z', 'y', 'b', 'x'])
  })

  it('shouldLeaveAViewWithoutLoadedEdgesAndAViewItCannotReadAlone', () => {
    const cache = setup()
    const { shown } = showView(cache, { items: null })
    showLibraryItems(cache, {
      libraryId: LIBRARY_ID,
      args: viewArgs(TITLE_ASC, { watchStatus: 'WATCHED' }),
    })

    apply(cache, [{ id: 'a', title: 'Alpha', ...started }])

    expect(shown()).toEqual(['a'])
  })

  it('shouldKeepAViewShownWhileAnotherScreenStillShowsIt', () => {
    const cache = setup()
    const first = showView(cache, { items: [{ id: 'a', title: 'Alpha', ...started }] })
    const second = showView(cache, { items: [{ id: 'a', title: 'Alpha', ...started }] })

    second.release()
    apply(cache, [{ id: 'b', title: 'Bravo', ...started }])

    expect(first.shown()).toEqual(['a', 'b'])
  })

  it('shouldLeaveContinueWatchingWhenAChangeHoldsNoMovieOrEpisode', () => {
    const cache = setup()
    showContinueWatching(cache)

    applyWatchStateToLists(cache, [
      { __typename: 'Season', id: 's1', watchStatus: 'WATCHED', watchProgress: null },
    ])

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

  it('shouldReadContinueWatchingAgainWhenATitleMovesPastTheEndOfAFullShelf', () => {
    const cache = setup()
    const variables = { continueWatchingFirst: CONTINUE_WATCHING_LIMIT }
    const entries = Array.from({ length: CONTINUE_WATCHING_LIMIT }, (_, index) => ({
      __typename: 'Movie',
      id: `w${index}`,
      title: `Title ${index}`,
      tagline: null,
      summary: null,
      runtime: null,
      createdOn: '2026-08-26T12:00:00Z',
      lastWatchedAt: `2026-10-16T09:${String(59 - index).padStart(2, '0')}:00Z`,
      genres: [],
      images: [],
      watchProgress: null,
      files: [],
    }))
    cache.writeQuery({
      query: HomeDocument,
      variables,
      data: { continueWatching: entries, libraries: [] } as never,
    })
    showContinueWatching(cache)

    apply(cache, [
      {
        id: 'w0',
        title: 'Title 0',
        watchStatus: 'IN_PROGRESS',
        lastWatchedAt: '2026-10-16T08:00:00Z',
      },
    ])

    expect(cache.readQuery({ query: HomeDocument, variables })).toBeNull()
  })
})
