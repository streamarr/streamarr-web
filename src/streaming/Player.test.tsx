import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { Player } from './Player'

const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
  supported: true,
}))

vi.mock('hls.js', () => ({
  default: class {
    static Events = { ERROR: 'hlsError' }
    static isSupported() {
      return hls.supported
    }
    loadSource = hls.loadSource
    attachMedia = hls.attachMedia
    destroy = hls.destroy
    on = hls.on
  },
}))

const STREAM_URL = '/api/stream/abcd/multivariant.m3u8?t=playback-token'
const SESSION = { id: 'sess-1', streamUrl: STREAM_URL, transcodeMode: 'REMUX' }

interface TimelineReport {
  sessionId: string
  positionSeconds: number
  state: string
}

function serveSession(): TimelineReport[] {
  const reports: TimelineReport[] = []
  server.use(
    graphql.mutation('CreateStreamSession', () => HttpResponse.json({ data: { createStreamSession: SESSION } })),
    graphql.mutation('ReportStreamSessionTimeline', ({ variables }) => {
      reports.push(variables as unknown as TimelineReport)
      return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
    }),
  )
  return reports
}

// jsdom's media element has no real timeline; an own property stands in for currentTime so the
// player's seek is observable and tests can move the playhead before firing events.
async function attachedVideo(): Promise<HTMLVideoElement> {
  await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))
  const video = document.querySelector('video')
  if (!video) {
    throw new Error('no video element rendered')
  }
  Object.defineProperty(video, 'currentTime', { writable: true, value: 0, configurable: true })
  return video
}

function playheadAt(video: HTMLVideoElement, seconds: number) {
  video.currentTime = seconds
  fireEvent(video, new Event('timeupdate'))
}

function Harness() {
  const [mediaFileId, setMediaFileId] = useState('a')
  return (
    <>
      <button type="button" onClick={() => setMediaFileId('b')}>
        Next
      </button>
      <Player mediaFileId={mediaFileId} />
    </>
  )
}

describe('Player', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shouldCreateSessionAndFeedTokenedUrlToHls', async () => {
    let variables: unknown
    server.use(
      graphql.mutation('CreateStreamSession', ({ variables: v }) => {
        variables = v
        return HttpResponse.json({ data: { createStreamSession: SESSION } })
      }),
    )

    renderWithProviders(<Player mediaFileId="abcd" />)

    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))
    expect(hls.attachMedia).toHaveBeenCalledOnce()
    expect(variables).toEqual({ mediaFileId: 'abcd' })
  })

  it('shouldShowErrorWhenSessionCreationFails', async () => {
    server.use(
      graphql.mutation('CreateStreamSession', () =>
        HttpResponse.json({ errors: [{ message: 'boom' }] }, { status: 200 }),
      ),
    )

    renderWithProviders(<Player mediaFileId="abcd" />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('shouldReportAFatalStreamErrorAndTearDownHls', async () => {
    server.use(
      graphql.mutation('CreateStreamSession', () =>
        HttpResponse.json({ data: { createStreamSession: SESSION } }),
      ),
    )
    renderWithProviders(<Player mediaFileId="abcd" />)
    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))

    const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
    expect(onError).toBeTypeOf('function')
    act(() => onError('hlsError', { fatal: true, type: 'networkError' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(hls.destroy).toHaveBeenCalled()
  })

  it('shouldRecoverWhenTheNextMediaFileStartsAfterAFailedOne', async () => {
    server.use(
      graphql.mutation('CreateStreamSession', ({ variables }) =>
        variables.mediaFileId === 'a'
          ? HttpResponse.json({ errors: [{ message: 'boom' }] }, { status: 200 })
          : HttpResponse.json({ data: { createStreamSession: SESSION } }),
      ),
    )
    const { user } = renderWithProviders(<Harness />)
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldSeekToTheStartPositionOnceMetadataLoads', async () => {
    serveSession()
    renderWithProviders(<Player mediaFileId="abcd" startPositionSeconds={120} />)
    const video = await attachedVideo()

    fireEvent(video, new Event('loadedmetadata'))

    expect(video.currentTime).toBe(120)
  })

  it('shouldStartFromTheBeginningWhenNoStartPositionIsGiven', async () => {
    serveSession()
    renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await attachedVideo()

    fireEvent(video, new Event('loadedmetadata'))

    expect(video.currentTime).toBe(0)
  })

  it('shouldReportPlayingTimelineEveryTenSecondsOfPlayback', async () => {
    const reports = serveSession()
    renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await attachedVideo()

    playheadAt(video, 3)
    playheadAt(video, 12)
    await waitFor(() =>
      expect(reports).toEqual([{ sessionId: 'sess-1', positionSeconds: 12, state: 'PLAYING' }]),
    )

    playheadAt(video, 15)
    playheadAt(video, 25)
    await waitFor(() => expect(reports).toHaveLength(2))
    expect(reports[1]).toEqual({ sessionId: 'sess-1', positionSeconds: 25, state: 'PLAYING' })
  })

  it('shouldReportPausedStateOnPause', async () => {
    const reports = serveSession()
    renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await attachedVideo()

    video.currentTime = 7
    fireEvent(video, new Event('pause'))

    await waitFor(() =>
      expect(reports).toEqual([{ sessionId: 'sess-1', positionSeconds: 7, state: 'PAUSED' }]),
    )
  })

  it('shouldReportStoppedStateAtTheLastKnownPositionOnUnmount', async () => {
    const reports = serveSession()
    const { unmount } = renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await attachedVideo()
    playheadAt(video, 42)
    await waitFor(() => expect(reports).toHaveLength(1))

    unmount()

    await waitFor(() => expect(reports).toHaveLength(2))
    expect(reports[1]).toEqual({ sessionId: 'sess-1', positionSeconds: 42, state: 'STOPPED' })
  })
})
