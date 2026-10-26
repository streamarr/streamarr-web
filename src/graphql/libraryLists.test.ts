import { gql, InMemoryCache } from '@apollo/client'
import { describe, expect, it } from 'vitest'
import { removeFromLibraryViews } from './libraryLists'

const TITLE_VIEWS = gql`
  query TitleViews {
    continueWatching(first: 10) {
      edges {
        itemId
      }
    }
    movie(id: "movie-1") {
      id
      title
    }
    series(id: "series-1") {
      id
      title
    }
    season(id: "season-1") {
      id
      title
    }
    episode(id: "episode-1") {
      id
      title
    }
  }
`

function cachedTitleViews() {
  const cache = new InMemoryCache()
  cache.writeQuery({
    query: TITLE_VIEWS,
    data: {
      continueWatching: { __typename: 'ContinueWatchingConnection', edges: [] },
      movie: { __typename: 'Movie', id: 'movie-1', title: 'Everlight' },
      series: { __typename: 'Series', id: 'series-1', title: 'Harbor' },
      season: { __typename: 'Season', id: 'season-1', title: 'Season 1' },
      episode: { __typename: 'Episode', id: 'episode-1', title: 'Pilot' },
    },
  })
  return cache
}

function rootFieldNames(cache: InMemoryCache) {
  const root = cache.extract().ROOT_QUERY ?? {}
  return Object.keys(root).map((key) => key.split('(')[0])
}

const TITLE_FIELDS = ['continueWatching', 'movie', 'series', 'season', 'episode']

describe('removeFromLibraryViews', () => {
  it('shouldForgetEveryCachedTitleViewWhenALibraryIsRemoved', () => {
    const cache = cachedTitleViews()
    expect(rootFieldNames(cache)).toEqual(expect.arrayContaining(TITLE_FIELDS))

    removeFromLibraryViews(cache, 'library-1')

    for (const fieldName of TITLE_FIELDS) expect(rootFieldNames(cache)).not.toContain(fieldName)
  })
})
