import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
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
    off = hls.off
    audioTracks = []
    audioTrack = -1
    subtitleTracks = []
    subtitleTrack = -1
  },
}))

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
