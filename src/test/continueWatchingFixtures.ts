interface Placement {
  id: string
  orderKey: string | null
  matchesFilter?: boolean
}

export function watchingMovie({ id }: Placement) {
  return {
    __typename: 'Movie' as const,
    id,
    title: id,
    titleSort: id,
    releaseDate: null,
    tagline: null,
    summary: null,
    runtime: 100,
    createdOn: '2026-10-19T15:07:00Z',
    genres: [],
    images: [],
    watchStatus: 'IN_PROGRESS' as const,
    lastWatchedAt: '2026-10-19T15:07:00Z',
    watchProgress: {
      __typename: 'WatchProgress' as const,
      positionSeconds: 600,
      percentComplete: 10,
      durationSeconds: 6000,
    },
    unmatched: false,
    library: { __typename: 'Library' as const, id: 'library' },
    files: [{ __typename: 'MediaFile' as const, id: `file-${id}` }],
  }
}

export function watchingEpisode(placement: Placement) {
  const movie = watchingMovie(placement)
  return {
    __typename: 'Episode' as const,
    id: placement.id,
    title: placement.id,
    episodeNumber: 1,
    overview: null,
    runtime: 100,
    images: [],
    watchStatus: movie.watchStatus,
    watchProgress: movie.watchProgress,
    files: movie.files,
    season: {
      __typename: 'Season' as const,
      id: 'season',
      seasonNumber: 1,
      series: {
        __typename: 'Series' as const,
        id: 'series',
        title: 'Series',
        tagline: null,
        summary: null,
        createdOn: movie.createdOn,
        genres: [],
        images: [],
        seasons: [{ __typename: 'Season' as const, id: 'season' }],
      },
    },
  }
}

export function watchingConnection<T>(nodes: T[]) {
  return {
    __typename: 'ContinueWatchingConnection' as const,
    edges: nodes.map((node, index) => ({
      __typename: 'ContinueWatchingEdge' as const,
      cursor: `cursor-${index}`,
      orderKey: String(index).padStart(3, '0'),
      node,
    })),
    pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
  }
}

export function watchingChange<T extends { id: string }>(node: T, orderKey: string | null) {
  return {
    itemId: node.id,
    edge:
      orderKey === null
        ? null
        : {
            __typename: 'ContinueWatchingEdge' as const,
            cursor: `cursor-${node.id}`,
            orderKey,
            node,
          },
  }
}
