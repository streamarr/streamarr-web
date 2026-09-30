import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hls } from '../../test/fakeHls'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

vi.mock('hls.js', async () => (await import('../../test/fakeHls')).hlsModule)

const ME = meFixture({ scope: 'profile' })
const STREAM_URL = '/api/stream/file-1/multivariant.m3u8?t=playback-token'

function serveApp() {
  server.use(
    graphql.mutation('DestroyStreamSession', () =>
      HttpResponse.json({ data: { destroyStreamSession: true } }),
    ),
    graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.mutation('CreateStreamSession', () =>
      HttpResponse.json({
        data: {
          createStreamSession: {
            session: { id: 'sess-1', streamUrl: STREAM_URL, transcodeMode: 'REMUX' },
            userErrors: [],
          },
        },
      }),
    ),
  )
}

const MOVIES: Record<string, object> = {
  m1: { __typename: 'Movie', id: 'm1', title: 'Everlight' },
}

const EPISODES: Record<string, object> = {
  e1: episodeFixture({ id: 'e1', title: 'Breakage', episodeNumber: 5 }),
  e2: episodeFixture({ id: 'e2', title: null, episodeNumber: 6 }),
}

function episodeFixture({
  id,
  title,
  episodeNumber,
}: {
  id: string
  title: string | null
  episodeNumber: number
}) {
  return {
    __typename: 'Episode',
    id,
    title,
    episodeNumber,
    season: {
      __typename: 'Season',
      id: 'season-2',
      seasonNumber: 2,
      series: { __typename: 'Series', id: 'series-1', title: 'Northern Line' },
    },
  }
}

function serveMediaTitles(): unknown[] {
  const requests: unknown[] = []
  server.use(
    graphql.query('PlayerMediaTitle', ({ variables }) => {
      requests.push(variables)
      const { id, movie } = variables as { id: string; movie: boolean }
      return HttpResponse.json({
        data: movie ? { movie: MOVIES[id] ?? null } : { episode: EPISODES[id] ?? null },
      })
    }),
  )
  return requests
}

async function attachedVideo(): Promise<HTMLVideoElement> {
  await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))
  const video = document.querySelector('video')
  if (!video) {
    throw new Error('no video element rendered')
  }
  Object.defineProperty(video, 'currentTime', { writable: true, value: 0, configurable: true })
  // jsdom cannot play, and the player starts playback once the stream loads.
  Object.defineProperty(video, 'play', { configurable: true, value: () => Promise.resolve() })
  return video
}

describe('/play/$mediaFileId', () => {
  afterEach(async () => {
    await act(async () => cleanup())
  })
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    {
      behavior: 'hands the position search param to the player as its start position',
      search: '?position=120',
      startsAt: 120,
    },
    { behavior: 'starts from the beginning when position is absent', search: '', startsAt: 0 },
    {
      behavior: 'starts from the beginning when position is not a number',
      search: '?position=soon',
      startsAt: 0,
    },
  ])('$behavior', async ({ search, startsAt }) => {
    serveApp()
    renderAppAt(`/play/file-1${search}`)
    const video = await attachedVideo()

    fireEvent(video, new Event('loadedmetadata'))

    expect(video.currentTime).toBe(startsAt)
  })

  it('shouldNameTheEpisodeAndItsSeriesInTheTitleLine', async () => {
    serveApp()
    serveMediaTitles()

    renderAppAt('/play/file-1?episode=e1&position=120')

    expect(await screen.findByRole('heading', { level: 1, name: 'Northern Line' })).toBeVisible()
    expect(screen.getByText('S2 E5 — Breakage')).toBeVisible()
  })

  it('shouldNameAnEpisodeWithoutATitleByItsNumber', async () => {
    serveApp()
    serveMediaTitles()

    renderAppAt('/play/file-1?episode=e2')

    expect(await screen.findByRole('heading', { level: 1, name: 'Northern Line' })).toBeVisible()
    expect(screen.getByText('S2 E6')).toBeVisible()
  })

  it('shouldNameTheMovieInTheTitleLine', async () => {
    serveApp()
    serveMediaTitles()

    renderAppAt('/play/file-1?movie=m1')

    expect(await screen.findByRole('heading', { level: 1, name: 'Everlight' })).toBeVisible()
  })

  it('shouldKeepTheAddressThePlayerWasOpenedAt', async () => {
    serveApp()
    serveMediaTitles()

    const { router } = renderAppAt('/play/file-1?episode=e1&position=120')
    await screen.findByRole('heading', { level: 1, name: 'Northern Line' })

    expect(router.state.location.href).toBe('/play/file-1?episode=e1&position=120')
  })

  it('shouldKeepTheAddressAPlayLinkOpens', async () => {
    serveApp()
    serveMediaTitles()
    const { router } = renderAppAt('/play/file-2')
    await attachedVideo()

    await act(() =>
      router.navigate({
        to: '/play/$mediaFileId',
        params: { mediaFileId: 'file-1' },
        search: { movie: 'm1' },
      }),
    )
    await screen.findByRole('heading', { level: 1, name: 'Everlight' })

    expect(router.state.location.href).toBe('/play/file-1?movie=m1')
  })

  it.each([
    { condition: 'NoMediaTitle', search: '?position=120' },
    { condition: 'AnEmptyMediaTitle', search: '?movie=' },
    { condition: 'BothAMovieAndAnEpisode', search: '?movie=m1&episode=e1' },
  ])('shouldLeaveTheTitleLineToTheTimecodeFor$condition', async ({ search }) => {
    serveApp()
    const requests = serveMediaTitles()

    renderAppAt(`/play/file-1${search}`)
    await attachedVideo()

    expect(requests).toEqual([])
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it.each([
    { condition: 'NoMediaTitle', search: {} },
    { condition: 'AnEmptyMediaTitle', search: { movie: '' } },
    { condition: 'BothAMovieAndAnEpisode', search: { movie: 'm1', episode: 'e1' } },
  ])(
    'shouldDropTheLastMediaTitleWhenThePlayerMovesToAnAddressWith$condition',
    async ({ search }) => {
      serveApp()
      serveMediaTitles()
      const { router } = renderAppAt('/play/file-1?movie=m1')
      await screen.findByRole('heading', { level: 1, name: 'Everlight' })

      await act(() =>
        router.navigate({ to: '/play/$mediaFileId', params: { mediaFileId: 'file-2' }, search }),
      )

      expect(router.state.location.pathname).toBe('/play/file-2')
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    },
  )

  it.each([
    { condition: 'CannotBeRead', answer: { errors: [{ message: 'boom' }] } },
    { condition: 'IsUnknown', answer: { data: { episode: null } } },
  ])('shouldKeepPlayingWithoutATitleWhenTheMediaTitle$condition', async ({ answer }) => {
    serveApp()
    let asked = false
    server.use(
      graphql.query('PlayerMediaTitle', () => {
        asked = true
        return HttpResponse.json(answer)
      }),
    )

    renderAppAt('/play/file-1?episode=e1')
    await waitFor(() => expect(asked).toBe(true))
    await attachedVideo()

    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldReturnHomeFromBackWhenThePlayerWasOpenedDirectly', async () => {
    serveApp()
    server.use(
      graphql.query('Home', () =>
        HttpResponse.json({ data: { continueWatching: [], libraries: [] } }),
      ),
    )
    const { user, router } = renderAppAt('/play/file-1')
    await attachedVideo()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByText(/nothing to watch yet/i)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
