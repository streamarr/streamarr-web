import { screen, waitFor } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { HomeQuery } from '../graphql/generated/graphql'
import { meFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const ME = meFixture({ scope: 'profile' })

function continueWatchingMovie(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Movie',
    id: 'movie-1',
    title: 'Everlight',
    tagline: 'Change begins with a whisper.',
    summary: 'A quiet town discovers a secret.',
    runtime: 142,
    createdOn: '2026-08-26T12:00:00Z',
    genres: [{ id: 'g1', name: 'Drama' }],
    images: [],
    watchProgress: { positionSeconds: 10, percentComplete: 5, durationSeconds: 200 },
    files: [{ id: 'file-1' }],
    ...overrides,
  }
}

function continueWatchingEpisode(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Episode',
    id: 'episode-1',
    title: 'Breakage',
    episodeNumber: 5,
    overview: 'The team regroups.',
    runtime: 47,
    images: [],
    watchProgress: { positionSeconds: 600, percentComplete: 40, durationSeconds: 1500 },
    files: [{ id: 'file-2' }],
    season: {
      id: 'season-1',
      seasonNumber: 2,
      series: {
        id: 'series-1',
        title: 'Northern Line',
        tagline: 'Their last resort.',
        summary: 'A crime drama.',
        createdOn: '2026-08-27T09:00:00Z',
        genres: [{ id: 'g2', name: 'Crime' }],
        seasons: [{ id: 's1' }, { id: 's2' }],
        images: [],
      },
    },
    ...overrides,
  }
}

function recentMovie(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Movie',
    id: 'movie-2',
    title: 'Grid Movie',
    titleSort: 'Grid Movie',
    releaseDate: '2024-01-01',
    runtime: 90,
    watchStatus: 'UNWATCHED',
    watchProgress: null,
    images: [],
    tagline: null,
    summary: null,
    createdOn: '2026-08-01T00:00:00Z',
    genres: [],
    files: [{ id: 'file-3' }],
    backdropImages: [],
    ...overrides,
  }
}

function recentSeries(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Series',
    id: 'series-2',
    title: 'Grid Series',
    titleSort: 'Grid Series',
    firstAirDate: '2020-01-01',
    watchStatus: 'UNWATCHED',
    watchProgress: null,
    images: [],
    tagline: null,
    summary: null,
    createdOn: '2026-08-01T00:00:00Z',
    genres: [],
    seasons: [{ id: 's1' }],
    backdropImages: [],
    ...overrides,
  }
}

function library(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lib-movies',
    name: 'Movies',
    type: 'MOVIE',
    items: { edges: [] },
    ...overrides,
  }
}

function homeData(overrides: Partial<{ continueWatching: unknown[]; libraries: unknown[] }> = {}): HomeQuery {
  return {
    continueWatching: overrides.continueWatching ?? [],
    libraries: overrides.libraries ?? [],
  } as HomeQuery
}

function serve(data: HomeQuery) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('Home', () => HttpResponse.json({ data })),
  )
}

describe('Home', () => {
  it('shows an error state when the query fails', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('Home', () => HttpResponse.json({ errors: [{ message: 'boom' }] })),
    )
    renderAppAt('/')
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  it('shows a full empty state when there is nothing anywhere', async () => {
    serve(homeData())
    renderAppAt('/')
    await waitFor(() => expect(screen.getByText('Nothing to watch yet.')).toBeInTheDocument())
  })

  it('builds the billboard from a Movie in continueWatching, resuming at its saved position', async () => {
    serve(homeData({ continueWatching: [continueWatchingMovie()] }))
    renderAppAt('/')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Everlight' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/play/file-1?position=10')
  })

  it('builds the billboard from an Episode in continueWatching, reading the parent series', async () => {
    serve(homeData({ continueWatching: [continueWatchingEpisode()] }))
    renderAppAt('/')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Northern Line' })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Resume S2 E5' })).toHaveAttribute('href', '/play/file-2?position=600')
  })

  it('resumes a Continue Watching card at its saved position', async () => {
    serve(homeData({ continueWatching: [continueWatchingMovie(), continueWatchingEpisode()] }))
    renderAppAt('/')
    await waitFor(() => expect(screen.getByText('Continue watching')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Breakage/ })).toHaveAttribute('href', '/play/file-2?position=600')
  })

  it('falls back to the newest recently-added item when continueWatching is empty', async () => {
    serve(
      homeData({
        libraries: [
          library({ items: { edges: [{ cursor: 'c1', node: recentMovie({ title: 'Older Movie', createdOn: '2026-08-01T00:00:00Z' }) }] } }),
          library({
            id: 'lib-series',
            name: 'Series',
            type: 'SERIES',
            items: { edges: [{ cursor: 'c2', node: recentSeries({ title: 'Fresher Show', createdOn: '2026-08-27T00:00:00Z' }) }] },
          }),
        ],
      }),
    )
    renderAppAt('/')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Fresher Show' })).toBeInTheDocument())
  })

  it('hides the Continue Watching shelf when it is empty', async () => {
    serve(homeData({ continueWatching: [], libraries: [library({ items: { edges: [{ cursor: 'c1', node: recentMovie() }] } })] }))
    renderAppAt('/')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Grid Movie' })).toBeInTheDocument())
    expect(screen.queryByText('Continue watching')).not.toBeInTheDocument()
  })

  it('links a recently-added movie card to its detail page', async () => {
    serve(homeData({ libraries: [library({ items: { edges: [{ cursor: 'c1', node: recentMovie() }] } })] }))
    renderAppAt('/')
    await waitFor(() => expect(screen.getByRole('link', { name: /Grid Movie/ })).toHaveAttribute('href', '/movie/movie-2'))
  })

  it('renders exactly one rail per Movie/Series library type, hiding a missing type', async () => {
    serve(
      homeData({
        continueWatching: [continueWatchingMovie()],
        libraries: [library({ items: { edges: [{ cursor: 'c1', node: recentMovie() }] } })],
      }),
    )
    renderAppAt('/')
    await waitFor(() => expect(screen.getByText('Recently added in Movies')).toBeInTheDocument())
    expect(screen.queryByText(/Recently added in Series/)).not.toBeInTheDocument()
  })
})
