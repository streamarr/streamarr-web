import { screen, waitFor } from '@testing-library/react'
import { graphql, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { HomeQuery } from '../graphql/generated/graphql'
import { deferred } from '../test/deferred'
import { failsOnceThen } from '../test/graphqlResponses'
import { meFixture } from '../test/meFixture'
import { renderAppAt, renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { Home } from './Home'

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

function homeData(
  overrides: Partial<{ continueWatching: unknown[]; libraries: unknown[] }> = {},
): HomeQuery {
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
  it('shouldPlayARecentMovieWhenItsFirstFileIsNull', async () => {
    serve(
      homeData({
        libraries: [
          library({
            items: {
              edges: [
                { cursor: 'movie', node: recentMovie({ files: [null, { id: 'available' }] }) },
              ],
            },
          }),
        ],
      }),
    )
    renderAppAt('/')
    expect(await screen.findByRole('link', { name: 'Play' })).toHaveAttribute(
      'href',
      '/play/available',
    )
  })

  it.each([
    { make: continueWatchingMovie, title: 'Everlight', action: 'Resume', position: 10 },
    { make: continueWatchingEpisode, title: 'Breakage', action: 'Resume S2 E5', position: 600 },
  ])(
    'shouldLinkTheBillboardAndShelfToAnAvailableFileFor$action',
    async ({ make, title, action, position }) => {
      serve(homeData({ continueWatching: [make({ files: [null, { id: 'available' }] })] }))
      renderAppAt('/')
      const href = `/play/available?position=${position}`
      expect(await screen.findByRole('link', { name: action })).toHaveAttribute('href', href)
      expect(screen.getByRole('link', { name: new RegExp(title) })).toHaveAttribute('href', href)
    },
  )

  it('guides an eligible admin to creation only for a successfully empty inventory', async () => {
    serve(homeData())
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({ data: { me: meFixture({ scope: 'profile', serverAdmin: true }) } }),
      ),
    )
    renderAppAt('/')
    expect(await screen.findByRole('link', { name: 'Add library' })).toHaveAttribute(
      'href',
      '/settings/server/libraries/new',
    )
  })

  it('does not mistake existing libraries with no indexed media for a new server', async () => {
    serve(homeData({ libraries: [library()] }))
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({ data: { me: meFixture({ scope: 'profile', serverAdmin: true }) } }),
      ),
    )
    renderAppAt('/')
    await screen.findByText('Nothing to watch yet.')
    expect(screen.queryByRole('link', { name: 'Add library' })).not.toBeInTheDocument()
  })

  it('gives regular users helpful empty-state copy without admin actions', async () => {
    serve(homeData())
    renderAppAt('/')
    await screen.findByText('Ask your server admin to add a library.')
    expect(screen.queryByRole('link', { name: 'Add library' })).not.toBeInTheDocument()
  })
  it('shouldWaitForTheAccountBeforeChoosingTheEmptyLibraryGuidance', async () => {
    const account = deferred()
    server.use(
      graphql.query('Home', () => HttpResponse.json({ data: homeData() })),
      graphql.query('Me', async () => {
        await account.promise
        return HttpResponse.json({
          data: { me: meFixture({ scope: 'profile', serverAdmin: true }) },
        })
      }),
    )
    renderWithProviders(<Home />)

    expect(await screen.findByRole('status', { name: 'Loading your account' })).toBeInTheDocument()
    expect(screen.queryByText('Ask your server admin to add a library.')).not.toBeInTheDocument()

    account.resolve()

    expect(await screen.findByRole('link', { name: 'Add library' })).toBeInTheDocument()
    expect(screen.queryByText('Ask your server admin to add a library.')).not.toBeInTheDocument()
  })

  it('shouldOfferRetryWhenTheAccountFailsBehindAnEmptyInventory', async () => {
    const account = failsOnceThen({ me: meFixture({ scope: 'profile', serverAdmin: true }) })
    server.use(
      graphql.query('Home', () => HttpResponse.json({ data: homeData() })),
      graphql.query('Me', account.resolver),
    )
    const { user } = renderWithProviders(<Home />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your account.")
    expect(screen.queryByText('Ask your server admin to add a library.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('link', { name: 'Add library' })).toBeInTheDocument()
  })

  it('omits empty recently-added sections when there is content elsewhere', async () => {
    serve(
      homeData({
        continueWatching: [continueWatchingMovie()],
        libraries: [library({ name: 'Empty library' })],
      }),
    )
    renderAppAt('/')
    await screen.findByRole('heading', { name: 'Everlight' })
    expect(
      screen.queryByRole('heading', { name: 'Recently added in Empty library' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'See all' })).not.toBeInTheDocument()
  })

  it('shows content from a second library of the same type when the first is empty', async () => {
    serve(
      homeData({
        libraries: [
          library({ id: 'empty', name: 'Empty movies' }),
          library({
            id: 'family',
            name: 'Family movies',
            items: {
              edges: [{ cursor: 'family-film', node: recentMovie({ title: 'Family Film' }) }],
            },
          }),
        ],
      }),
    )
    renderAppAt('/')
    await screen.findByRole('heading', { name: 'Family Film' })
    expect(
      screen.getByRole('heading', { name: 'Recently added in Family movies' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Nothing to watch yet.')).not.toBeInTheDocument()
  })

  it('shouldRetryHomeAfterItFailsToLoad', async () => {
    const home = failsOnceThen(homeData({ continueWatching: [continueWatchingMovie()] }))
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('Home', home.resolver),
    )
    const { user } = renderAppAt('/')

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your library.")
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Everlight' })).toBeInTheDocument()
    expect(home.calls).toBe(2)
  })

  it('shouldShowTheServersWordsWhenHomeFails', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('Home', () =>
        HttpResponse.json({
          errors: [{ message: 'Library storage is offline.', extensions: { code: 'UNAVAILABLE' } }],
        }),
      ),
    )
    renderAppAt('/')

    expect(await screen.findByRole('alert')).toHaveTextContent('Library storage is offline.')
  })

  it('shouldSignOutFromAFailedHome', async () => {
    let revoked = false
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('Home', () => HttpResponse.json({ errors: [{ message: 'boom' }] })),
      http.post('/api/auth/refresh/revoke', () => {
        revoked = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { router, user } = renderAppAt('/')
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(revoked).toBe(true)
  })

  it('shows a full empty state when there is nothing anywhere', async () => {
    serve(homeData())
    renderAppAt('/')
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Nothing to watch yet' })).toBeInTheDocument(),
    )
  })

  it('builds the billboard from a Movie in continueWatching, resuming at its saved position', async () => {
    serve(homeData({ continueWatching: [continueWatchingMovie()] }))
    renderAppAt('/')
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Everlight' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute(
      'href',
      '/play/file-1?position=10',
    )
  })

  it('builds the billboard from an Episode in continueWatching, reading the parent series', async () => {
    serve(homeData({ continueWatching: [continueWatchingEpisode()] }))
    renderAppAt('/')
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Northern Line' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: 'Resume S2 E5' })).toHaveAttribute(
      'href',
      '/play/file-2?position=600',
    )
  })

  it('resumes a Continue Watching card at its saved position', async () => {
    serve(homeData({ continueWatching: [continueWatchingMovie(), continueWatchingEpisode()] }))
    renderAppAt('/')
    await waitFor(() => expect(screen.getByText('Continue watching')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Breakage/ })).toHaveAttribute(
      'href',
      '/play/file-2?position=600',
    )
  })

  it('falls back to the newest recently-added item when continueWatching is empty', async () => {
    serve(
      homeData({
        libraries: [
          library({
            items: {
              edges: [
                {
                  cursor: 'c1',
                  node: recentMovie({ title: 'Older Movie', createdOn: '2026-08-01T00:00:00Z' }),
                },
              ],
            },
          }),
          library({
            id: 'lib-series',
            name: 'Series',
            type: 'SERIES',
            items: {
              edges: [
                {
                  cursor: 'c2',
                  node: recentSeries({ title: 'Fresher Show', createdOn: '2026-08-27T00:00:00Z' }),
                },
              ],
            },
          }),
        ],
      }),
    )
    renderAppAt('/')
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Fresher Show' })).toBeInTheDocument(),
    )
  })

  it('hides the Continue Watching shelf when it is empty', async () => {
    serve(
      homeData({
        continueWatching: [],
        libraries: [library({ items: { edges: [{ cursor: 'c1', node: recentMovie() }] } })],
      }),
    )
    renderAppAt('/')
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Grid Movie' })).toBeInTheDocument(),
    )
    expect(screen.queryByText('Continue watching')).not.toBeInTheDocument()
  })

  it('links a recently-added movie card to its detail page', async () => {
    serve(
      homeData({
        libraries: [library({ items: { edges: [{ cursor: 'c1', node: recentMovie() }] } })],
      }),
    )
    renderAppAt('/')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Grid Movie/ })).toHaveAttribute(
        'href',
        '/movie/movie-2',
      ),
    )
  })

  it('links a recently-added series card to its detail page', async () => {
    serve(
      homeData({
        libraries: [
          library({
            id: 'lib-series',
            name: 'Series',
            type: 'SERIES',
            items: { edges: [{ cursor: 'c2', node: recentSeries() }] },
          }),
        ],
      }),
    )
    renderAppAt('/')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Grid Series/ })).toHaveAttribute(
        'href',
        '/series/series-2',
      ),
    )
  })

  it('renders a rail for each available library, hiding a missing type', async () => {
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
