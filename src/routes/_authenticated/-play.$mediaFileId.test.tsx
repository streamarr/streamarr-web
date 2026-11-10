import { watchingConnection } from '../../test/continueWatchingFixtures'
import { readyPlaybackSession, destroyedPlaybackSession } from '../../test/playbackSession'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatePlaybackSessionInput } from '../../graphql/generated/graphql'
import { hls } from '../../test/fakeHls'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

vi.mock('hls.js', async () => (await import('../../test/fakeHls')).hlsModule)

const ME = meFixture({ scope: 'profile' })
const STREAM_URL = '/api/stream/file-1/multivariant.m3u8?t=playback-token'

function serveApp() {
  server.use(
    graphql.mutation('DestroyPlaybackSession', ({ variables }) =>
      HttpResponse.json({ data: { destroyPlaybackSession: destroyedPlaybackSession(variables) } }),
    ),
    graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.mutation('CreatePlaybackSession', () =>
      HttpResponse.json({
        data: {
          createPlaybackSession: {
            playbackSession: readyPlaybackSession({
              streamSession: { id: 'sess-1', streamUrl: STREAM_URL, transcodeMode: 'REMUX' },
            }),
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
  return attachedVideoAt(STREAM_URL)
}

async function attachedVideoAt(streamUrl: string): Promise<HTMLVideoElement> {
  await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(streamUrl))
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

  it('shouldStartAtTheNewPositionInAutoWhenThePlayerMovesThereAfterAQualityPick', async () => {
    serveApp()
    const created: string[] = []
    server.use(
      graphql.mutation('CreatePlaybackSession', ({ variables }) => {
        const { options } = (variables as { input: CreatePlaybackSessionInput }).input
        created.push(options?.quality ?? 'without a choice')
        const id = `sess-${created.length}`
        return HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: readyPlaybackSession({
                streamSession: { id, streamUrl: `/api/stream/${id}.m3u8`, transcodeMode: 'REMUX' },
                requestedChoice: options?.quality ?? 'AUTO',
                playbackChoice: options?.quality ?? 'AUTO',
              }),
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user, router } = renderAppAt('/play/file-1')
    const video = await attachedVideoAt('/api/stream/sess-1.m3u8')
    fireEvent(video, new Event('loadedmetadata'))
    video.currentTime = 73.25
    await user.click(screen.getByRole('button', { name: 'Quality: Auto' }))
    await user.click(screen.getByRole('menuitemradio', { name: '720p' }))
    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith('/api/stream/sess-2.m3u8'))

    await act(() =>
      router.navigate({
        to: '/play/$mediaFileId',
        params: { mediaFileId: 'file-1' },
        search: { position: 120 },
      }),
    )

    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith('/api/stream/sess-3.m3u8'))
    fireEvent(video, new Event('loadedmetadata'))
    expect(video.currentTime).toBe(120)
    expect(created).toEqual(['AUTO', 'HIGH_720P', 'AUTO'])
  })

  it('shouldNameTheEpisodeAndItsSeriesInTheTitleLine', async () => {
    serveApp()
    serveMediaTitles()

    renderAppAt('/play/file-1?episode=e1&position=120')

    expect(await screen.findByRole('heading', { level: 1, name: 'Northern Line' })).toBeVisible()
    expect(screen.getByText('S2 E5 — Breakage')).toBeVisible()
  })

  it('shouldStoreAnAudioSwitchForTheEpisodeThePlayLinkNames', async () => {
    serveApp()
    serveMediaTitles()
    const overrides: unknown[] = []
    server.use(
      graphql.mutation('SetLanguageOverride', ({ variables }) => {
        overrides.push(variables.input)
        return HttpResponse.json({ data: { setLanguageOverride: { item: null, userErrors: [] } } })
      }),
    )
    const { user } = renderAppAt('/play/file-1?episode=e1')
    await attachedVideo()
    hls.audioTracks = [
      { name: 'English', lang: 'en' },
      { name: '日本語', lang: 'ja' },
    ]
    hls.audioTrack = 0
    act(() => hls.emit('hlsAudioTracksUpdated'))

    // The chip names the tracks once the player has attached the stream they belong to.
    await user.click(await screen.findByRole('button', { name: 'Audio: English' }))
    await user.click(screen.getByRole('menuitemradio', { name: '日本語' }))

    await waitFor(() => expect(overrides).toEqual([{ itemId: 'e1', audioLanguage: 'JA' }]))
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
        HttpResponse.json({ data: { continueWatching: watchingConnection([]), libraries: [] } }),
      ),
    )
    const { user, router } = renderAppAt('/play/file-1')
    await attachedVideo()

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByText(/nothing to watch yet/i)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
