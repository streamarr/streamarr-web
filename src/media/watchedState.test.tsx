import { deferred } from '../test/deferred'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hls } from '../test/fakeHls'
import { meFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

vi.mock('hls.js', async () => (await import('../test/fakeHls')).hlsModule)

afterEach(async () => {
  await act(async () => cleanup())
})

function profileSelectedWithoutLibraries() {
  return [
    graphql.query('Me', () => HttpResponse.json({ data: { me: meFixture({ scope: 'profile' }) } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
  ]
}

function movieDetail({
  watchStatus,
  watchProgress = null,
}: {
  watchStatus: string
  watchProgress?: { positionSeconds: number; percentComplete: number } | null
}) {
  return {
    __typename: 'Movie',
    id: 'm1',
    title: 'Everlight',
    tagline: null,
    summary: null,
    runtime: 90,
    releaseDate: '2024-01-01',
    contentRating: null,
    genres: [],
    directors: [],
    cast: [],
    ratings: [],
    files: [{ __typename: 'MediaFile', id: 'f1' }],
    watchStatus,
    watchProgress,
    backdropImages: [],
    posterImages: [],
  }
}

function streamSessionCreated() {
  return graphql.mutation('CreateStreamSession', () =>
    HttpResponse.json({
      data: {
        createStreamSession: {
          session: {
            id: 'stream1',
            streamUrl: '/api/stream/f1/main.m3u8?t=playback',
            transcodeMode: 'REMUX',
          },
          userErrors: [],
        },
      },
    }),
  )
}

describe('watched state across routes', () => {
  it('shouldUpdateTheSeriesActionFromTheMarkedSeasonWithoutLoadingTheSeriesAgain', async () => {
    let seriesRequests = 0
    const episode = () => ({
      __typename: 'Episode',
      id: 'e1',
      title: 'First',
      episodeNumber: 1,
      runtime: 45,
      watchStatus: 'UNWATCHED',
      watchProgress: null,
      files: [{ __typename: 'MediaFile', id: 'f1' }],
      stillImages: [],
    })
    const season = () => ({
      __typename: 'Season',
      id: 's1',
      title: 'Season 1',
      seasonNumber: 1,
      overview: 'One season',
      airDate: '2024-01-01',
      watchStatus: 'UNWATCHED',
      watchProgress: null,
      episodes: [episode()],
      posterImages: [],
      backdropImages: [],
    })
    server.use(
      ...profileSelectedWithoutLibraries(),
      graphql.query('SeriesDetail', () => {
        seriesRequests += 1
        return HttpResponse.json({
          data: {
            series: {
              __typename: 'Series',
              id: 'r1',
              title: 'Northern Line',
              tagline: null,
              summary: null,
              firstAirDate: '2024-01-01',
              contentRating: null,
              genres: [],
              directors: [],
              cast: [],
              watchStatus: 'UNWATCHED',
              seasons: [season()],
              backdropImages: [],
              posterImages: [],
            },
          },
        })
      }),
      graphql.query('SeasonDetail', () =>
        HttpResponse.json({
          data: {
            season: {
              ...season(),
              series: {
                __typename: 'Series',
                id: 'r1',
                title: 'Northern Line',
                contentRating: null,
                directors: [],
                seasons: [season()],
                backdropImages: [],
              },
            },
          },
        }),
      ),
      graphql.mutation('MarkWatched', () => {
        const watched = { watchStatus: 'WATCHED', watchProgress: null }
        return HttpResponse.json({
          data: {
            markWatched: {
              item: {
                __typename: 'Season',
                id: 's1',
                ...watched,
                episodes: [{ __typename: 'Episode', id: 'e1', ...watched }],
                series: { __typename: 'Series', id: 'r1', ...watched },
              },
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderAppAt('/series/r1')
    await screen.findByRole('button', { name: 'Mark series watched' })
    await user.click(screen.getByRole('link', { name: /Season 1/ }))
    await user.click(await screen.findByRole('button', { name: 'Mark season watched' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark watched' }),
    )
    await screen.findByRole('button', { name: 'Mark season unwatched' })
    await user.click(screen.getByRole('link', { name: 'Northern Line' }))
    await screen.findByRole('heading', { name: 'Northern Line', level: 1 })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark series unwatched' })).toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Watched')).toBeInTheDocument()
    expect(seriesRequests).toBe(1)
  })
  it('shouldLoadContinueWatchingAgainAfterMarkingItsMovieWatched', async () => {
    let watched = false
    let homeRequests = 0
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({ data: { me: meFixture({ scope: 'profile' }) } }),
      ),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('Home', () => {
        homeRequests += 1
        return HttpResponse.json({
          data: {
            libraries: [],
            continueWatching: watched
              ? []
              : [
                  {
                    __typename: 'Movie',
                    id: 'm1',
                    title: 'Everlight',
                    tagline: null,
                    summary: null,
                    runtime: 90,
                    createdOn: '2024-01-01T00:00:00Z',
                    genres: [],
                    images: [],
                    files: [{ id: 'f1' }],
                    watchProgress: {
                      positionSeconds: 20,
                      percentComplete: 2,
                      durationSeconds: 5400,
                    },
                  },
                ],
          },
        })
      }),
      graphql.query('MovieDetail', () =>
        HttpResponse.json({
          data: {
            movie: {
              __typename: 'Movie',
              id: 'm1',
              title: 'Everlight',
              tagline: null,
              summary: null,
              runtime: 90,
              releaseDate: '2024-01-01',
              contentRating: null,
              genres: [],
              directors: [],
              cast: [],
              ratings: [],
              files: [{ __typename: 'MediaFile', id: 'f1' }],
              watchStatus: 'IN_PROGRESS',
              watchProgress: { positionSeconds: 20, percentComplete: 2, durationSeconds: 5400 },
              backdropImages: [],
              posterImages: [],
            },
          },
        }),
      ),
      graphql.mutation('MarkWatched', () => {
        watched = true
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
    const { user, router } = renderAppAt('/')
    await screen.findByRole('heading', { name: 'Continue watching' })
    await act(async () => {
      await router.navigate({ to: '/movie/$movieId', params: { movieId: 'm1' } })
    })

    await user.click(await screen.findByRole('button', { name: 'Mark watched' }))
    await screen.findByRole('button', { name: 'Mark unwatched' })
    await act(async () => {
      router.history.back()
    })

    await screen.findByRole('heading', { name: 'Nothing to watch yet' })
    expect(screen.queryByRole('heading', { name: 'Continue watching' })).not.toBeInTheDocument()
    expect(homeRequests).toBe(2)
  })
  it('shouldShowTheMovieWatchedWhenPlaybackReachesItsEndBeforeTheViewerLeaves', async () => {
    let watched = false
    let destroyed = false
    const stoppedPositions: number[] = []
    server.use(
      ...profileSelectedWithoutLibraries(),
      graphql.query('MovieDetail', () =>
        HttpResponse.json({
          data: { movie: movieDetail({ watchStatus: watched ? 'WATCHED' : 'UNWATCHED' }) },
        }),
      ),
      streamSessionCreated(),
      graphql.mutation('ReportStreamSessionTimeline', ({ variables }) => {
        if (variables.state === 'STOPPED') {
          stoppedPositions.push(variables.positionSeconds as number)
          watched = true
        }
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
      graphql.mutation('DestroyStreamSession', () => {
        destroyed = true
        return HttpResponse.json({ data: { destroyStreamSession: true } })
      }),
    )
    const { user, router } = renderAppAt('/movie/m1')
    await user.click(await screen.findByRole('link', { name: 'Play' }))
    await waitFor(() => expect(hls.loadSource).toHaveBeenCalled())
    const video = document.querySelector('video')!
    Object.defineProperty(video, 'currentTime', { writable: true, configurable: true, value: 5400 })

    fireEvent(video, new Event('timeupdate'))
    fireEvent(video, new Event('pause'))
    fireEvent(video, new Event('ended'))

    await waitFor(() => expect(stoppedPositions).toEqual([5400]))
    await act(async () => {
      router.history.back()
    })
    await screen.findByRole('button', { name: 'Mark unwatched' })
    await waitFor(() => expect(destroyed).toBe(true))
    expect(stoppedPositions).toEqual([5400])
  })
  it('shouldShowTheMovieWatchedAfterLeavingWhenTheEndOfPlaybackReportFailed', async () => {
    let watched = false
    let refusedStop = false
    server.use(
      ...profileSelectedWithoutLibraries(),
      graphql.query('MovieDetail', () =>
        HttpResponse.json({
          data: { movie: movieDetail({ watchStatus: watched ? 'WATCHED' : 'UNWATCHED' }) },
        }),
      ),
      streamSessionCreated(),
      graphql.mutation('ReportStreamSessionTimeline', ({ variables }) => {
        if (variables.state !== 'STOPPED') {
          return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
        }
        if (!refusedStop) {
          refusedStop = true
          return HttpResponse.json({ errors: [{ message: 'Temporarily unavailable' }] })
        }
        watched = true
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
      graphql.mutation('DestroyStreamSession', () =>
        HttpResponse.json({ data: { destroyStreamSession: true } }),
      ),
    )
    const { user, router } = renderAppAt('/movie/m1')
    await user.click(await screen.findByRole('link', { name: 'Play' }))
    await waitFor(() => expect(hls.loadSource).toHaveBeenCalled())
    const video = document.querySelector('video')!
    Object.defineProperty(video, 'currentTime', { writable: true, configurable: true, value: 5400 })
    fireEvent(video, new Event('timeupdate'))
    fireEvent(video, new Event('pause'))
    fireEvent(video, new Event('ended'))
    await waitFor(() => expect(refusedStop).toBe(true))

    await act(async () => {
      router.history.back()
    })

    expect(await screen.findByRole('button', { name: 'Mark unwatched' })).toBeInTheDocument()
  })
  it('shouldResumeFromReportedProgressAfterReturningToTheMovie', async () => {
    let position = 20
    let holdMovie = false
    let destroyed = false
    const reload = deferred()
    const stop = deferred()
    server.use(
      ...profileSelectedWithoutLibraries(),
      graphql.query('Home', () =>
        HttpResponse.json({
          data: {
            libraries: [],
            continueWatching:
              position > 20
                ? [
                    {
                      __typename: 'Movie',
                      id: 'm1',
                      title: 'Everlight',
                      tagline: null,
                      summary: null,
                      runtime: 90,
                      createdOn: '2024-01-01T00:00:00Z',
                      genres: [],
                      images: [],
                      files: [{ id: 'f1' }],
                      watchProgress: {
                        positionSeconds: position,
                        percentComplete: 2,
                        durationSeconds: 5400,
                      },
                    },
                  ]
                : [],
          },
        }),
      ),
      graphql.query('MovieDetail', async () => {
        if (holdMovie) await reload.promise
        return HttpResponse.json({
          data: {
            movie: movieDetail({
              watchStatus: 'IN_PROGRESS',
              watchProgress: { positionSeconds: position, percentComplete: 2 },
            }),
          },
        })
      }),
      graphql.mutation('DestroyStreamSession', () => {
        destroyed = true
        return HttpResponse.json({ data: { destroyStreamSession: true } })
      }),
      streamSessionCreated(),
      graphql.mutation('ReportStreamSessionTimeline', async ({ variables }) => {
        if (variables.state === 'STOPPED') await stop.promise
        position = variables.positionSeconds as number
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
    )
    const { user, router } = renderAppAt('/')
    await screen.findByRole('heading', { name: 'Nothing to watch yet' })
    await act(async () => {
      await router.navigate({ to: '/movie/$movieId', params: { movieId: 'm1' } })
    })
    await user.click(await screen.findByRole('link', { name: 'Resume' }))
    await waitFor(() => expect(hls.loadSource).toHaveBeenCalled())
    const video = document.querySelector('video')!
    Object.defineProperty(video, 'currentTime', { writable: true, configurable: true, value: 80 })
    fireEvent(video, new Event('timeupdate'))
    await waitFor(() => expect(position).toBe(80))
    await act(async () => {
      router.history.back()
    })
    const resume = await screen.findByRole('link', { name: 'Resume' })
    expect(resume).toHaveAttribute('href', '/play/f1?movie=m1&position=80')
    holdMovie = true
    stop.resolve()
    try {
      await waitFor(() => expect(destroyed).toBe(true))
    } finally {
      reload.resolve()
    }
    await act(async () => {
      await router.navigate({ to: '/' })
    })
    await screen.findByRole('heading', { name: 'Continue watching' })
  })
})
