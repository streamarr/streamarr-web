import { deferred } from '../test/deferred'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { Player } from './Player'

const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn<(event: string, listener: (event: string, data: unknown) => void) => void>(),
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
    graphql.mutation('CreateStreamSession', () =>
      HttpResponse.json({ data: { createStreamSession: { session: SESSION, userErrors: [] } } }),
    ),
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
    server.use(
      graphql.mutation('DestroyStreamSession', () =>
        HttpResponse.json({ data: { destroyStreamSession: true } }),
      ),
    )
  })

  afterEach(async () => {
    await act(async () => cleanup())
  })

  it('shouldKeepTheFinalPositionWhenAnEarlierReportIsDelayed', async () => {
    const gate = deferred()
    const started = deferred()
    const persisted: TimelineReport[] = []
    serveSession()
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', async ({ variables }) => {
        const report = variables as unknown as TimelineReport
        if (report.state === 'PLAYING') {
          started.resolve()
          await gate.promise
        }
        persisted.push(report)
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
    )
    const { unmount } = renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await attachedVideo()
    playheadAt(video, 12)
    await started.promise
    playheadAt(video, 15)
    await act(async () => unmount())
    gate.resolve()

    await waitFor(() => expect(persisted).toHaveLength(2))
    expect(persisted.at(-1)).toMatchObject({ state: 'STOPPED', positionSeconds: 15 })
  })

  it('shouldSaveTheFinalPositionAndReleaseTheSessionAfterAReportFails', async () => {
    const started = deferred()
    const saved: unknown[] = []
    let destroyed = false
    serveSession()
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', ({ variables }) => {
        if (variables.state === 'PLAYING') {
          started.resolve()
          return HttpResponse.json({ errors: [{ message: 'Temporarily unavailable' }] })
        }
        saved.push(variables)
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
      graphql.mutation('DestroyStreamSession', () => {
        destroyed = true
        return HttpResponse.json({ data: { destroyStreamSession: true } })
      }),
    )
    const { unmount } = renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await attachedVideo()
    playheadAt(video, 12)
    await started.promise
    playheadAt(video, 15)
    unmount()
    await waitFor(() => expect(destroyed).toBe(true))
    expect(saved).toEqual([{ sessionId: 'sess-1', state: 'STOPPED', positionSeconds: 15 }])
  })

  it('shouldCreateSessionAndFeedTokenedUrlToHls', async () => {
    let variables: unknown
    server.use(
      graphql.mutation('CreateStreamSession', ({ variables: v }) => {
        variables = v
        return HttpResponse.json({
          data: { createStreamSession: { session: SESSION, userErrors: [] } },
        })
      }),
    )

    renderWithProviders(<Player mediaFileId="abcd" />)

    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))
    expect(hls.attachMedia).toHaveBeenCalledOnce()
    expect(variables).toEqual({ input: { mediaFileId: 'abcd' } })
  })

  it('shouldDestroyASessionThatFinishesCreatingAfterThePlayerLeaves', async () => {
    const gate = deferred()
    const started = deferred()
    const destroyed: unknown[] = []
    server.use(
      graphql.mutation('CreateStreamSession', async () => {
        started.resolve()
        await gate.promise
        return HttpResponse.json({
          data: { createStreamSession: { session: SESSION, userErrors: [] } },
        })
      }),
      graphql.mutation('DestroyStreamSession', ({ variables }) => {
        destroyed.push(variables.sessionId)
        return HttpResponse.json({ data: { destroyStreamSession: true } })
      }),
    )
    const { unmount } = renderWithProviders(<Player mediaFileId="abcd" />)
    await started.promise
    unmount()
    gate.resolve()

    await waitFor(() => expect(destroyed).toEqual(['sess-1']))
    expect(hls.attachMedia).not.toHaveBeenCalled()
  })

  it('shouldReleaseTheSessionAfterReportingItsFinalPosition', async () => {
    const gate = deferred()
    const started = deferred()
    const completed: string[] = []
    serveSession()
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', async () => {
        started.resolve()
        await gate.promise
        completed.push('STOPPED')
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
      graphql.mutation('DestroyStreamSession', () => {
        completed.push('DESTROYED')
        return HttpResponse.json({ data: { destroyStreamSession: true } })
      }),
    )
    const { unmount } = renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await attachedVideo()
    playheadAt(video, 5)
    unmount()
    await started.promise
    gate.resolve()

    await waitFor(() => expect(completed).toEqual(['STOPPED', 'DESTROYED']))
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

  it('shouldShowTheServersRefusalWhenTheSessionIsRefused', async () => {
    server.use(
      graphql.mutation('CreateStreamSession', () =>
        HttpResponse.json({
          data: {
            createStreamSession: {
              session: null,
              userErrors: [
                {
                  __typename: 'TranscodeCapacityUnavailableError',
                  message: 'Every transcode slot is busy. Try again in a moment.',
                },
              ],
            },
          },
        }),
      ),
    )

    renderWithProviders(<Player mediaFileId="abcd" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Every transcode slot is busy. Try again in a moment.',
    )
    expect(hls.loadSource).not.toHaveBeenCalled()
  })

  it('shouldReportAFatalStreamErrorAndTearDownHls', async () => {
    server.use(
      graphql.mutation('CreateStreamSession', () =>
        HttpResponse.json({ data: { createStreamSession: { session: SESSION, userErrors: [] } } }),
      ),
    )
    renderWithProviders(<Player mediaFileId="abcd" />)
    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))

    const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
    expect(onError).toBeTypeOf('function')
    act(() => onError?.('hlsError', { fatal: true, type: 'networkError' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(hls.destroy).toHaveBeenCalled()
  })

  it('shouldRecoverWhenTheNextMediaFileStartsAfterAFailedOne', async () => {
    server.use(
      graphql.mutation('CreateStreamSession', ({ variables }) =>
        (variables as { input: { mediaFileId: string } }).input.mediaFileId === 'a'
          ? HttpResponse.json({ errors: [{ message: 'boom' }] }, { status: 200 })
          : HttpResponse.json({
              data: { createStreamSession: { session: SESSION, userErrors: [] } },
            }),
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
