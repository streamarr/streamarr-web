import { deferred } from '../test/deferred'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { meFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
}))
vi.mock('hls.js', () => ({
  default: class {
    static Events = { ERROR: 'hlsError' }
    static isSupported() {
      return true
    }
    loadSource = hls.loadSource
    attachMedia = hls.attachMedia
    destroy = hls.destroy
    on = hls.on
  },
}))

afterEach(async () => {
  await act(async () => cleanup())
})

describe('watched state across routes', () => {
  it('shouldRefreshTheSeriesActionAfterMarkingItsSeasonWatched', async () => {
    let watched = false
    const status = () => (watched ? 'WATCHED' : 'UNWATCHED')
    const episode = () => ({
      __typename: 'Episode',
      id: 'e1',
      title: 'First',
      episodeNumber: 1,
      runtime: 45,
      watchStatus: status(),
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
      watchStatus: status(),
      watchProgress: null,
      episodes: [episode()],
      posterImages: [],
      backdropImages: [],
    })
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({ data: { me: meFixture({ scope: 'profile' }) } }),
      ),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeriesDetail', () => {
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
              watchStatus: status(),
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
        watched = true
        return HttpResponse.json({ data: { markWatched: true } })
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
  })
  it('shouldResumeFromReportedProgressAfterReturningToTheMovie', async () => {
    let position = 20
    let holdMovie = false
    let destroyed = false
    const reload = deferred()
    const stop = deferred()
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({ data: { me: meFixture({ scope: 'profile' }) } }),
      ),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
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
              watchProgress: { positionSeconds: position, percentComplete: 2 },
              backdropImages: [],
              posterImages: [],
            },
          },
        })
      }),
      graphql.mutation('DestroyStreamSession', () => {
        destroyed = true
        return HttpResponse.json({ data: { destroyStreamSession: true } })
      }),
      graphql.mutation('CreateStreamSession', () =>
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
      ),
      graphql.mutation('ReportStreamSessionTimeline', async ({ variables }) => {
        if (variables.state === 'STOPPED') await stop.promise
        position = variables.positionSeconds as number
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
    )
    const { user, router } = renderAppAt('/')
    await screen.findByText('Nothing to watch yet.')
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
    expect(resume).toHaveAttribute('href', '/play/f1?position=80')
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
