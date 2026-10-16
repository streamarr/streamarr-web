import { screen, waitFor } from '@testing-library/react'
import { graphql, HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { MovieDetailQuery } from '../graphql/generated/graphql'
import { deferred } from '../test/deferred'
import { meFixture, profileFixture } from '../test/meFixture'
import {
  answersInTurn,
  answersThenHolds,
  answerWith,
  comeBackOnline,
  comeBackOnlineUntil,
  failsOnceThen,
  heldAnswer,
  invalidIdResponse,
  networkFailure,
} from '../test/graphqlResponses'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const ME = meFixture({ scope: 'profile' })

const AMBER_THEME = {
  base: '#d9c5a5',
  panel: '#cdb99a',
  selected: '#f0c069',
  accent: '#6b3a10',
  onAccent: '#f6e7cf',
  textPrimary: '#241505',
  textSecondary: '#5b4326',
}

const TEAL_THEME = { ...AMBER_THEME, accent: '#6fe0bf', base: '#0e3b34' }

// Fragment spreads on Image only match in the cache when the object carries its __typename.
function image(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Image',
    aspectRatio: 1.78,
    blurHash: null,
    ambientColors: null,
    variants: [{ id: 'v1', size: 'LARGE', width: 1920, height: 1080, url: 'backdrop.jpg' }],
    ...overrides,
  }
}

function colored(theme: typeof AMBER_THEME) {
  return {
    topLeft: '#e9b658',
    topRight: '#e9b658',
    bottomRight: '#e9b658',
    bottomLeft: '#e9b658',
    primary: '#e9b658',
    theme,
  }
}

function movieData(overrides: Record<string, unknown> = {}): MovieDetailQuery {
  return {
    movie: {
      __typename: 'Movie',
      id: 'm1',
      title: 'Everlight',
      tagline: 'Change begins with a whisper.',
      summary: 'A quiet town discovers a secret.',
      runtime: 142,
      releaseDate: '2024-05-10',
      contentRating: { value: 'PG-13' },
      genres: [{ id: 'g1', name: 'Drama' }],
      directors: [{ id: 'p1', name: 'Placeholder Director' }],
      cast: [{ id: 'p2', name: 'Lead Actor', images: [] }],
      ratings: [{ id: 'r1', source: 'TMDB', value: '7.8' }],
      files: [{ id: 'file-1' }],
      watchStatus: 'UNWATCHED',
      watchProgress: null,
      backdropImages: [image({ ambientColors: colored(AMBER_THEME) })],
      posterImages: [],
      ...overrides,
    },
  } as MovieDetailQuery
}

function serve(data: MovieDetailQuery, requestedIds: string[] = []) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('MovieDetail', ({ variables }) => {
      requestedIds.push(variables.id as string)
      return HttpResponse.json({ data })
    }),
  )
}

describe('MovieDetailScreen', () => {
  it('shouldPlayTheFirstAvailableFileWhenTheFileListStartsWithNull', async () => {
    serve(movieData({ files: [null, { id: 'file-1' }] }))
    renderAppAt('/movie/m1')
    expect(await screen.findByRole('link', { name: 'Play' })).toHaveAttribute(
      'href',
      '/play/file-1?movie=m1',
    )
  })

  it('shouldKeepTheMovieOnScreenWhileItIsReadAgain', async () => {
    serve(movieData())
    const movie = answersThenHolds(movieData(), movieData({ tagline: 'Every light goes out.' }))
    server.use(graphql.query('MovieDetail', movie.resolver))
    renderAppAt('/movie/m1')
    const title = await screen.findByRole('heading', { level: 1, name: 'Everlight' })

    comeBackOnline()
    await waitFor(() => expect(movie.calls).toBe(2))
    expect(title).toBeInTheDocument()
    movie.release()

    expect(await screen.findByText('Every light goes out.')).toBeInTheDocument()
    expect(title).toBeInTheDocument()
  })

  it('shouldKeepNotFoundOnScreenWhileTheMovieIsReadAgain', async () => {
    serve({ movie: null })
    const movie = answersThenHolds({ movie: null }, { movie: null })
    server.use(graphql.query('MovieDetail', movie.resolver))
    renderAppAt('/movie/m1')
    const notFound = await screen.findByRole('alert')

    comeBackOnline()
    await waitFor(() => expect(movie.calls).toBe(2))
    expect(notFound).toBeInTheDocument()
    expect(notFound).toHaveTextContent("This movie doesn't exist or was removed.")
    movie.release()
  })

  it('shouldKeepTheMovieWhenReadingItAgainFails', async () => {
    serve(movieData())
    const fresh = heldAnswer(movieData({ tagline: 'Every light goes out.' }))
    const movie = answersInTurn(answerWith(movieData()), networkFailure, fresh.answer)
    server.use(graphql.query('MovieDetail', movie.resolver))
    renderAppAt('/movie/m1')
    const title = await screen.findByRole('heading', { level: 1, name: 'Everlight' })

    await comeBackOnlineUntil(movie, 3)
    expect(title).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fresh.release()

    expect(await screen.findByText('Every light goes out.')).toBeInTheDocument()
    expect(title).toBeInTheDocument()
  })

  it('shouldRetryTheMovieAfterItFailsToLoad', async () => {
    const movie = failsOnceThen(movieData())
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('MovieDetail', movie.resolver),
    )
    const { user } = renderAppAt('/movie/m1')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load this movie.")
    expect(alert).not.toHaveTextContent('boom')

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Everlight' })).toBeInTheDocument()
    expect(movie.calls).toBe(2)
  })

  it('shouldShowNotFoundWithoutRetryWhenTheMovieDoesNotExist', async () => {
    serve({ movie: null })
    server.use(
      graphql.query('Home', () =>
        HttpResponse.json({ data: { continueWatching: [], libraries: [] } }),
      ),
    )
    const { router, user } = renderAppAt('/movie/m1')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This movie doesn't exist or was removed.",
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('shouldTreatAMalformedMovieIdAsNotFound', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('MovieDetail', () => invalidIdResponse('movie')),
    )
    renderAppAt('/movie/abc')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This movie doesn't exist or was removed.",
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('queries the movie named in the URL and renders its header', async () => {
    const requestedIds: string[] = []
    serve(movieData(), requestedIds)
    renderAppAt('/movie/m1')

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Everlight' })).toBeInTheDocument(),
    )
    expect(requestedIds).toEqual(['m1'])
    expect(screen.getByText('Change begins with a whisper.')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByText('2h 22m')).toBeInTheDocument()
    expect(screen.getByText('PG-13')).toBeInTheDocument()
    expect(screen.getByText('A quiet town discovers a secret.')).toBeInTheDocument()
    expect(screen.getByText('Directed by')).toBeInTheDocument()
    expect(screen.getByText('Placeholder Director')).toBeInTheDocument()
    expect(screen.getByText('Drama')).toBeInTheDocument()
    expect(screen.getByText('TMDB · 7.8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('shouldSayYearRuntimeAndRatingOnceInTheMetaLine', async () => {
    serve(movieData())
    renderAppAt('/movie/m1')
    await screen.findByRole('heading', { level: 1, name: 'Everlight' })

    const [year, runtime, rating] = [/2024/, '2h 22m', 'PG-13'].map((fact) => {
      const matches = screen.getAllByText(fact)
      expect(matches).toHaveLength(1)
      return matches[0]
    })
    expect(year.compareDocumentPosition(runtime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(runtime.compareDocumentPosition(rating) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shouldKeepOnlyCreditsInTheMetadataColumns', async () => {
    serve(movieData())
    renderAppAt('/movie/m1')
    await screen.findByRole('heading', { level: 1, name: 'Everlight' })

    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Genre',
      'Directed by',
    ])
    expect(screen.getAllByRole('definition').map((value) => value.textContent)).toEqual([
      'Drama',
      'Placeholder Director',
    ])
  })

  it('links Play to the file when the movie has not been started', async () => {
    serve(movieData())
    renderAppAt('/movie/m1')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Play' })).toHaveAttribute(
        'href',
        '/play/file-1?movie=m1',
      ),
    )
  })

  it('links Resume to the saved position when the movie is in progress', async () => {
    serve(
      movieData({
        watchStatus: 'IN_PROGRESS',
        watchProgress: { positionSeconds: 120, percentComplete: 50 },
      }),
    )
    renderAppAt('/movie/m1')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute(
        'href',
        '/play/file-1?movie=m1&position=120',
      ),
    )
  })

  it('tints the page from the backdrop theme', async () => {
    serve(movieData())
    renderAppAt('/movie/m1')
    await waitFor(() =>
      expect(screen.getByTestId('ambient-scope').style.getPropertyValue('--ambient-accent')).toBe(
        '#6b3a10',
      ),
    )
  })

  it('falls back to the poster theme when the backdrop has not been colored', async () => {
    serve(
      movieData({
        backdropImages: [image()],
        posterImages: [image({ ambientColors: colored(TEAL_THEME) })],
      }),
    )
    renderAppAt('/movie/m1')
    await waitFor(() =>
      expect(screen.getByTestId('ambient-scope').style.getPropertyValue('--ambient-accent')).toBe(
        '#6fe0bf',
      ),
    )
  })

  it('stays neutral when no artwork has been colored', async () => {
    serve(movieData({ backdropImages: [image()] }))
    renderAppAt('/movie/m1')
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Everlight' })).toBeInTheDocument(),
    )
    expect(screen.getByTestId('ambient-scope').style.getPropertyValue('--ambient-accent')).toBe('')
  })

  it('shouldFlipTheVerbFromTheMarkedItemWithoutLoadingTheMovieAgain', async () => {
    const requestedIds: string[] = []
    const markedIds: string[] = []
    serve(movieData({ watchStatus: 'IN_PROGRESS' }), requestedIds)
    server.use(
      graphql.mutation('MarkWatched', ({ variables }) => {
        markedIds.push((variables.input as { itemId: string }).itemId)
        return HttpResponse.json({
          data: {
            markWatched: {
              item: { __typename: 'Movie', id: 'm1', watchStatus: 'WATCHED', watchProgress: null },
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderAppAt('/movie/m1')

    await user.click(await screen.findByRole('button', { name: 'Mark watched' }))

    expect(await screen.findByRole('button', { name: 'Mark unwatched' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Play' })).toBeInTheDocument()
    expect(markedIds).toEqual(['m1'])
    expect(requestedIds).toEqual(['m1'])
  })

  it('shouldEndOnTheMarkedStateWhenAQuietRefreshFromBeforeTheMarkAnswersAfterIt', async () => {
    serve(movieData())
    const staleRelease = deferred()
    let staleAnswered = false
    let readsAfterTheStaleAnswer = 0
    const movie = answersInTurn(
      answerWith(movieData()),
      async () => {
        await staleRelease.promise
        staleAnswered = true
        return HttpResponse.json({ data: movieData() })
      },
      () => {
        if (staleAnswered) readsAfterTheStaleAnswer += 1
        return HttpResponse.json({ data: movieData({ watchStatus: 'WATCHED' }) })
      },
    )
    server.use(
      graphql.query('MovieDetail', movie.resolver),
      graphql.mutation('MarkWatched', () =>
        HttpResponse.json({
          data: {
            markWatched: {
              item: { __typename: 'Movie', id: 'm1', watchStatus: 'WATCHED', watchProgress: null },
              userErrors: [],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt('/movie/m1')
    const mark = await screen.findByRole('button', { name: 'Mark watched' })
    comeBackOnline()
    await waitFor(() => expect(movie.calls).toBe(2))

    await user.click(mark)
    await screen.findByRole('button', { name: 'Mark unwatched' })
    staleRelease.resolve()

    await waitFor(() => expect(readsAfterTheStaleAnswer).toBe(1))
    expect(await screen.findByRole('button', { name: 'Mark unwatched' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Mark watched' })).not.toBeInTheDocument()
  })

  it('shouldFinishTheMarkWhileAnotherQuietReadIsStillAnswering', async () => {
    serve(movieData())
    const libraries = answersThenHolds({ libraries: [] }, { libraries: [] })
    server.use(
      graphql.query('Libraries', libraries.resolver),
      graphql.mutation('MarkWatched', () =>
        HttpResponse.json({
          data: {
            markWatched: {
              item: { __typename: 'Movie', id: 'm1', watchStatus: 'WATCHED', watchProgress: null },
              userErrors: [],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt('/movie/m1')
    const mark = await screen.findByRole('button', { name: 'Mark watched' })
    comeBackOnline()
    await waitFor(() => expect(libraries.calls).toBe(2))

    await user.click(mark)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark unwatched' })).toBeEnabled(),
    )
    libraries.release()
  })

  it('shouldKeepTheNextProfilesWatchStateWhenTheEarlierProfilesMarkAnswersAfterTheSwitch', async () => {
    const requestedIds: string[] = []
    const markSent = deferred()
    const markAnswer = deferred()
    serve(movieData({ watchStatus: 'UNWATCHED' }), requestedIds)
    const household = meFixture({
      scope: 'profile',
      profiles: [
        profileFixture({ id: 'p-alex', name: 'Alex', selected: true }),
        profileFixture({ id: 'p-sam', name: 'Sam', personal: false }),
      ],
    })
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: household } })),
      http.post('/api/auth/select-profile', () =>
        HttpResponse.json({
          accessToken: 'access',
          accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
          scope: 'profile',
        }),
      ),
      graphql.mutation('MarkWatched', async () => {
        markSent.resolve()
        await markAnswer.promise
        return HttpResponse.json({
          data: {
            markWatched: {
              item: { __typename: 'Movie', id: 'm1', watchStatus: 'WATCHED', watchProgress: null },
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderAppAt('/movie/m1')
    await user.click(await screen.findByRole('button', { name: 'Mark watched' }))
    await markSent.promise

    await user.click(screen.getByRole('button', { name: /profile menu \(alex\)/i }))
    await user.click(screen.getByRole('button', { name: 'Sam' }))
    await waitFor(() => expect(requestedIds).toEqual(['m1', 'm1']))
    markAnswer.resolve()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't update the watched state\.$/,
    )
    expect(screen.getByRole('button', { name: 'Mark watched' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Mark unwatched' })).not.toBeInTheDocument()
  })

  it('shouldShowTheServerMessageWhenTheMarkIsRefused', async () => {
    serve(movieData())
    server.use(
      graphql.mutation('MarkWatched', () =>
        HttpResponse.json({
          data: {
            markWatched: {
              item: null,
              userErrors: [
                {
                  __typename: 'ItemNotFoundError',
                  message: 'No movie, episode, season or series has the given ID.',
                },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt('/movie/m1')

    await user.click(await screen.findByRole('button', { name: 'Mark watched' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No movie, episode, season or series has the given ID.',
    )
    expect(screen.getByRole('button', { name: 'Mark watched' })).toBeEnabled()
  })

  it('shouldShowAGenericFailureWhenTheMarkCannotReachTheServer', async () => {
    serve(movieData())
    server.use(graphql.mutation('MarkWatched', () => HttpResponse.error()))
    const { user } = renderAppAt('/movie/m1')

    await user.click(await screen.findByRole('button', { name: 'Mark watched' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't update the watched state\.$/,
    )
  })

  it('shouldShowTheServersWordsWhenTheWatchedStateCannotBeSaved', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('MovieDetail', () => HttpResponse.json({ data: movieData() })),
      graphql.mutation('MarkWatched', () =>
        HttpResponse.json({
          errors: [
            {
              message: 'Watch history is read-only during maintenance.',
              extensions: { code: 'UNAVAILABLE' },
            },
          ],
        }),
      ),
    )
    const { user } = renderAppAt('/movie/m1')
    await user.click(await screen.findByRole('button', { name: 'Mark watched' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Watch history is read-only during maintenance\.$/,
    )
    expect(screen.getByRole('button', { name: 'Mark watched' })).toBeEnabled()
  })

  it('omits the cast shelf when there is no cast', async () => {
    serve(movieData({ cast: [] }))
    renderAppAt('/movie/m1')
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Everlight' })).toBeInTheDocument(),
    )
    expect(screen.queryByText('Cast')).not.toBeInTheDocument()
  })

  it('lists the cast in a shelf when present', async () => {
    serve(movieData())
    renderAppAt('/movie/m1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cast' })).toBeInTheDocument())
    expect(screen.getByText('Lead Actor')).toBeInTheDocument()
  })
})
