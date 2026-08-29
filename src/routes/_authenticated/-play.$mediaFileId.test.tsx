import { fireEvent, waitFor } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

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

const ME = meFixture({ scope: 'profile' })
const STREAM_URL = '/api/stream/file-1/multivariant.m3u8?t=playback-token'

function serveApp() {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.mutation('CreateStreamSession', () =>
      HttpResponse.json({
        data: { createStreamSession: { id: 'sess-1', streamUrl: STREAM_URL, transcodeMode: 'REMUX' } },
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
  return video
}

describe('/play/$mediaFileId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hands the position search param to the player as its start position', async () => {
    serveApp()
    renderAppAt('/play/file-1?position=120')
    const video = await attachedVideo()

    fireEvent(video, new Event('loadedmetadata'))

    expect(video.currentTime).toBe(120)
  })

  it('starts from the beginning when position is absent', async () => {
    serveApp()
    renderAppAt('/play/file-1')
    const video = await attachedVideo()

    fireEvent(video, new Event('loadedmetadata'))

    expect(video.currentTime).toBe(0)
  })

  it('starts from the beginning when position is not a number', async () => {
    serveApp()
    renderAppAt('/play/file-1?position=soon')
    const video = await attachedVideo()

    fireEvent(video, new Event('loadedmetadata'))

    expect(video.currentTime).toBe(0)
  })
})
