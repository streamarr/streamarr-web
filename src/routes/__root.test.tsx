import { screen } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  MovieDetailQuery,
  SeasonDetailQuery,
  SeriesDetailQuery,
} from '../graphql/generated/graphql'
import { meFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'
import styles from '../ui/HomeShell.module.css'

const ME = meFixture({ scope: 'profile' })

const MOVIE: MovieDetailQuery = {
  movie: {
    __typename: 'Movie',
    id: 'm1',
    title: 'Everlight',
    tagline: null,
    summary: null,
    runtime: 142,
    releaseDate: '2024-05-10',
    contentRating: null,
    genres: [],
    directors: [],
    cast: [],
    ratings: [],
    files: [],
    watchStatus: 'UNWATCHED',
    watchProgress: null,
    backdropImages: [],
    posterImages: [],
  },
} as MovieDetailQuery

const SERIES: SeriesDetailQuery = {
  series: {
    __typename: 'Series',
    id: 'series-1',
    title: 'Northern Line',
    tagline: null,
    summary: null,
    firstAirDate: '2017-07-21',
    contentRating: null,
    genres: [],
    directors: [],
    cast: [],
    watchStatus: 'UNWATCHED',
    seasons: [],
    backdropImages: [],
    posterImages: [],
  },
} as SeriesDetailQuery

const SEASON: SeasonDetailQuery = {
  season: {
    __typename: 'Season',
    id: 'season-2',
    title: 'Season 2',
    seasonNumber: 2,
    overview: null,
    airDate: '2018-03-01',
    watchStatus: 'UNWATCHED',
    series: {
      id: 'series-1',
      title: 'Northern Line',
      contentRating: null,
      directors: [],
      seasons: [],
      backdropImages: [],
    },
    episodes: [],
    backdropImages: [],
    posterImages: [],
  },
} as SeasonDetailQuery

describe('the root layout', () => {
  it('shouldRenderACeremonyWithoutTheSignedInChrome', async () => {
    renderAppAt('/login')

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(document.querySelector(`.${styles.homeShell}`)).toBeNull()
  })

  it('shouldKeepTheSignedInChromeOnTheAmbientMovieDetailPage', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('MovieDetail', () => HttpResponse.json({ data: MOVIE })),
    )
    renderAppAt('/movie/m1')

    expect(await screen.findByRole('heading', { level: 1, name: 'Everlight' })).toBeInTheDocument()
    expect(screen.getByTestId('ambient-scope')).toContainElement(
      screen.getByRole('navigation', { name: 'Primary' }),
    )
    expect(document.querySelector(`.${styles.homeShell}`)).toBeNull()
  })

  it('shouldKeepTheSignedInChromeOnTheAmbientSeriesDetailPage', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeriesDetail', () => HttpResponse.json({ data: SERIES })),
    )
    renderAppAt('/series/series-1')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Northern Line' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('ambient-scope')).toContainElement(
      screen.getByRole('navigation', { name: 'Primary' }),
    )
    expect(document.querySelector(`.${styles.homeShell}`)).toBeNull()
  })

  it('shouldKeepTheSignedInChromeOnTheAmbientSeasonDetailPage', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeasonDetail', () => HttpResponse.json({ data: SEASON })),
    )
    renderAppAt('/season/season-2')

    expect(await screen.findByRole('heading', { level: 1, name: 'Season 2' })).toBeInTheDocument()
    expect(screen.getByTestId('ambient-scope')).toContainElement(
      screen.getByRole('navigation', { name: 'Primary' }),
    )
    expect(document.querySelector(`.${styles.homeShell}`)).toBeNull()
  })

  it('shouldWrapASignedInPageInTheChrome', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('Home', () =>
        HttpResponse.json({ data: { continueWatching: [], libraries: [] } }),
      ),
    )
    renderAppAt('/')

    expect(await screen.findByText(/nothing to watch yet/i)).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(document.querySelector(`.${styles.homeShell}`)).not.toBeNull()
  })
})
