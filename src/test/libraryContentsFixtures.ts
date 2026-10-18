export const LIBRARY = '44444444-4444-4444-4444-444444444444'

type MovieOptions = { id?: string; title?: string }

export function movie({ id = 'a', title = 'Alpha' }: MovieOptions = {}) {
  return {
    __typename: 'Movie' as const,
    id,
    title,
    titleSort: title,
    releaseDate: '2024-01-01',
    runtime: 100,
    watchStatus: 'UNWATCHED' as const,
    lastWatchedAt: null,
    watchProgress: null,
    images: [],
  }
}

export function edge(options: MovieOptions = {}) {
  const node = movie(options)
  return { cursor: `cursor-${node.id}`, orderKey: node.title, node }
}

export function addition(options: MovieOptions = {}) {
  const item = movie(options)
  return {
    data: {
      change: {
        __typename: 'LibraryItemChange',
        libraryId: LIBRARY,
        itemId: item.id,
        kind: 'MOVIE',
        item,
        position: {
          __typename: 'LibraryItemPosition',
          matchesFilter: true,
          cursor: `cursor-${item.id}`,
          orderKey: item.title,
        },
      },
    },
  }
}
