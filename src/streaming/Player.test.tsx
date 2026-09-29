import { deferred } from '../test/deferred'
import { act, cleanup, configure, fireEvent, screen, waitFor } from '@testing-library/react'
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
const CAPACITY_REFUSAL = 'Every transcode slot is busy. Try again in a moment.'

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

function refuseSession() {
  server.use(
    graphql.mutation('CreateStreamSession', () =>
      HttpResponse.json({
        data: {
          createStreamSession: {
            session: null,
            userErrors: [
              { __typename: 'TranscodeCapacityUnavailableError', message: CAPACITY_REFUSAL },
            ],
          },
        },
      }),
    ),
  )
}

function failSessionCreation() {
  server.use(
    graphql.mutation('CreateStreamSession', () =>
      HttpResponse.json({ errors: [{ message: 'boom' }] }, { status: 200 }),
    ),
  )
}

function serveSingleWorkerSlot({
  beforeCreated,
  beforeDestroyed,
  onCreateAttempt,
}: {
  beforeCreated?: (mediaFileId: string) => Promise<void>
  beforeDestroyed?: () => Promise<void>
  onCreateAttempt?: (mediaFileId: string) => void
} = {}): Set<string> {
  const activeSessions = new Set<string>()
  server.use(
    graphql.mutation('CreateStreamSession', async ({ variables }) => {
      const { mediaFileId } = variables.input as { mediaFileId: string }
      onCreateAttempt?.(mediaFileId)
      if (activeSessions.size > 0) {
        return HttpResponse.json({
          errors: [{ message: 'No connected transcode worker can run this variant' }],
        })
      }
      const session = {
        ...SESSION,
        id: `sess-${mediaFileId}`,
        streamUrl: `/api/stream/${mediaFileId}/multivariant.m3u8?t=playback-token`,
      }
      activeSessions.add(session.id)
      await beforeCreated?.(mediaFileId)
      return HttpResponse.json({
        data: { createStreamSession: { session, userErrors: [] } },
      })
    }),
    graphql.mutation('DestroyStreamSession', async ({ variables }) => {
      await beforeDestroyed?.()
      activeSessions.delete(variables.sessionId as string)
      return HttpResponse.json({ data: { destroyStreamSession: true } })
    }),
  )
  return activeSessions
}

async function attachedVideo(streamUrl = STREAM_URL): Promise<HTMLVideoElement> {
  return videoWhen(() => expect(hls.loadSource).toHaveBeenCalledWith(streamUrl))
}

async function nativeVideo(streamUrl = STREAM_URL): Promise<HTMLVideoElement> {
  return videoWhen((video) => expect(video).toHaveAttribute('src', streamUrl))
}

// Testing Library's waitFor stalls under faked timers; vi.waitFor advances them while it polls.
async function videoWhen(
  expectation: (video: HTMLVideoElement) => void,
): Promise<HTMLVideoElement> {
  const video = await act(() =>
    vi.waitFor(() => {
      const element = document.querySelector('video')
      if (!element) {
        throw new Error('no video element rendered')
      }
      expectation(element)
      return element
    }),
  )
  return fakeMedia(video)
}

// jsdom's media element has no real timeline and cannot load. Own properties stand in for
// currentTime, so the player's seek is observable and tests can move the playhead, and for load(),
// whose reset rewinds the playhead with a timeupdate as a browser's does.
function fakeMedia(video: HTMLVideoElement): HTMLVideoElement {
  Object.defineProperty(video, 'currentTime', { writable: true, value: 0, configurable: true })
  Object.defineProperty(video, 'load', {
    configurable: true,
    value: () => {
      if (video.currentTime === 0) {
        return
      }
      video.currentTime = 0
      video.dispatchEvent(new Event('timeupdate'))
    },
  })
  return video
}

function raiseHlsFatalError() {
  const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
  expect(onError).toBeTypeOf('function')
  act(() => onError?.('hlsError', { fatal: true, type: 'networkError' }))
}

function playheadAt(video: HTMLVideoElement, seconds: number) {
  video.currentTime = seconds
  fireEvent(video, new Event('timeupdate'))
}

interface StreamPath {
  supported: boolean
  streamingVideo: () => Promise<HTMLVideoElement>
  failStream: (video: HTMLVideoElement) => void
  expectStreamReleased: (video: HTMLVideoElement) => void
}

const STREAM_PATHS: [string, StreamPath][] = [
  [
    'NativePath',
    {
      supported: false,
      streamingVideo: nativeVideo,
      failStream: (video) => fireEvent(video, new Event('error')),
      expectStreamReleased: (video) => expect(video).not.toHaveAttribute('src'),
    },
  ],
  [
    'HlsJsPath',
    {
      supported: true,
      streamingVideo: attachedVideo,
      failStream: raiseHlsFatalError,
      expectStreamReleased: () => expect(hls.destroy).toHaveBeenCalledOnce(),
    },
  ],
]

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

function RemountHarness() {
  const [shown, setShown] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setShown((value) => !value)}>
        {shown ? 'Leave playback' : 'Return to playback'}
      </button>
      {shown && <Player mediaFileId="abcd" />}
    </>
  )
}

describe('Player', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hls.supported = true
    server.use(
      graphql.mutation('DestroyStreamSession', () =>
        HttpResponse.json({ data: { destroyStreamSession: true } }),
      ),
    )
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => cleanup())
    configure({ reactStrictMode: false })
  })

  it('shouldAbandonStalledTimelineReportsAndReleaseTheSessionBeforeReplacement', async () => {
    const reportStarted = deferred()
    const reportResponse = deferred()
    const reports: TimelineReport[] = []
    let reportAborted = false
    const activeSessions = serveSingleWorkerSlot()
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', async ({ variables, request }) => {
        reports.push(variables as unknown as TimelineReport)
        request.signal.addEventListener('abort', () => {
          reportAborted = true
        })
        reportStarted.resolve()
        await reportResponse.promise
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
    )
    const { unmount } = renderWithProviders(<Harness />)
    const video = await attachedVideo('/api/stream/a/multivariant.m3u8?t=playback-token')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    playheadAt(video, 12)
    await reportStarted.promise
    playheadAt(video, 25)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    vi.useRealTimers()
    await waitFor(() =>
      expect(hls.loadSource).toHaveBeenLastCalledWith(
        '/api/stream/b/multivariant.m3u8?t=playback-token',
      ),
    )
    expect(reportAborted).toBe(true)
    expect(reports).toEqual([{ sessionId: 'sess-a', positionSeconds: 12, state: 'PLAYING' }])
    expect(activeSessions).toEqual(new Set(['sess-b']))
    reportResponse.resolve()
    unmount()
    await waitFor(() => expect(activeSessions.size).toBe(0))
  })

  it('shouldPreserveOrderedProgressWhenASlowReportFinishesDuringPlayback', async () => {
    const started = deferred()
    const response = deferred()
    const saved: number[] = []
    let aborted = false
    serveSession()
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', async ({ variables, request }) => {
        request.signal.addEventListener('abort', () => {
          aborted = true
        })
        started.resolve()
        await response.promise
        saved.push(variables.positionSeconds as number)
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
    )
    renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await attachedVideo()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    playheadAt(video, 12)
    await started.promise
    playheadAt(video, 25)

    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    vi.useRealTimers()
    expect(aborted).toBe(false)
    response.resolve()
    await waitFor(() => expect(saved).toEqual([12, 25]))
  })

  it('shouldBoundTheWaitForDestructionWithoutStartingAnotherSessionBeforeAcknowledgement', async () => {
    const destructionStarted = deferred()
    const destructionResponse = deferred()
    const attempts: string[] = []
    const activeSessions = serveSingleWorkerSlot({
      onCreateAttempt: (mediaFileId) => attempts.push(mediaFileId),
      beforeDestroyed: async () => {
        destructionStarted.resolve()
        await destructionResponse.promise
      },
    })
    const { user, unmount } = renderWithProviders(<Harness />)
    await attachedVideo('/api/stream/a/multivariant.m3u8?t=playback-token')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await destructionStarted.promise

    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    vi.useRealTimers()
    expect(screen.getByRole('alert')).toHaveTextContent('Playback is taking too long to start.')
    expect(attempts).toEqual(['a'])
    expect(activeSessions).toEqual(new Set(['sess-a']))

    destructionResponse.resolve()
    await waitFor(() => expect(activeSessions.size).toBe(0))
    await user.click(screen.getByRole('button', { name: 'Retry playback' }))
    await waitFor(() =>
      expect(hls.loadSource).toHaveBeenLastCalledWith(
        '/api/stream/b/multivariant.m3u8?t=playback-token',
      ),
    )
    expect(attempts).toEqual(['a', 'b'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    unmount()
    await waitFor(() => expect(activeSessions.size).toBe(0))
  })

  it.each(['rejected', 'unacknowledged'] as const)(
    'shouldRetryDestructionBeforeCreatingAnotherSessionWhenCleanupIs%s',
    async (outcome) => {
      const attempts: string[] = []
      const activeSessions = serveSingleWorkerSlot({
        onCreateAttempt: (mediaFileId) => attempts.push(mediaFileId),
      })
      let destructions = 0
      server.use(
        graphql.mutation('DestroyStreamSession', ({ variables }) => {
          destructions += 1
          if (destructions > 1) {
            activeSessions.delete(variables.sessionId as string)
            return HttpResponse.json({ data: { destroyStreamSession: true } })
          }
          return outcome === 'unacknowledged'
            ? HttpResponse.json({ data: { destroyStreamSession: false } })
            : HttpResponse.json({ errors: [{ message: 'Cleanup temporarily unavailable' }] })
        }),
      )
      const { user, unmount } = renderWithProviders(<Harness />)
      await attachedVideo('/api/stream/a/multivariant.m3u8?t=playback-token')

      await user.click(screen.getByRole('button', { name: 'Next' }))
      await screen.findByRole('alert')
      expect(attempts).toEqual(['a'])
      expect(activeSessions).toEqual(new Set(['sess-a']))

      await user.click(screen.getByRole('button', { name: 'Retry playback' }))
      await waitFor(() =>
        expect(hls.loadSource).toHaveBeenLastCalledWith(
          '/api/stream/b/multivariant.m3u8?t=playback-token',
        ),
      )
      expect(destructions).toBe(2)
      expect(activeSessions).toEqual(new Set(['sess-b']))
      unmount()
      await waitFor(() => expect(activeSessions.size).toBe(0))
    },
  )

  it('shouldRetryTimedOutDestructionWithoutReleasingOwnershipBeforeAcknowledgement', async () => {
    const firstStarted = deferred()
    const firstResponse = deferred()
    const recoveryStarted = deferred()
    const recoveryResponse = deferred()
    const attempts: string[] = []
    const activeSessions = serveSingleWorkerSlot({
      onCreateAttempt: (mediaFileId) => attempts.push(mediaFileId),
    })
    let destructionCount = 0
    let firstAborted = false
    server.use(
      graphql.mutation('DestroyStreamSession', async ({ variables, request }) => {
        destructionCount += 1
        if (destructionCount === 1) {
          request.signal.addEventListener('abort', () => {
            firstAborted = true
          })
          firstStarted.resolve()
          await firstResponse.promise
        }
        if (destructionCount > 1) {
          recoveryStarted.resolve()
          await recoveryResponse.promise
        }
        activeSessions.delete(variables.sessionId as string)
        return HttpResponse.json({ data: { destroyStreamSession: true } })
      }),
    )
    const { user, unmount } = renderWithProviders(<Harness />)
    await attachedVideo('/api/stream/a/multivariant.m3u8?t=playback-token')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await firstStarted.promise

    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    vi.useRealTimers()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(firstAborted).toBe(true)
    expect(attempts).toEqual(['a'])
    await user.click(screen.getByRole('button', { name: 'Retry playback' }))
    await recoveryStarted.promise
    expect(activeSessions).toEqual(new Set(['sess-a']))
    recoveryResponse.resolve()

    await waitFor(() =>
      expect(hls.loadSource).toHaveBeenLastCalledWith(
        '/api/stream/b/multivariant.m3u8?t=playback-token',
      ),
    )
    expect(activeSessions).toEqual(new Set(['sess-b']))
    firstResponse.resolve()
    unmount()
    await waitFor(() => expect(activeSessions.size).toBe(0))
  })

  it('shouldReleaseASessionCreatedAfterTimeoutBeforeAllowingRetryToCreateAnother', async () => {
    const creationStarted = deferred()
    const creationResponse = deferred()
    const attempts: string[] = []
    const activeSessions = serveSingleWorkerSlot({
      onCreateAttempt: (mediaFileId) => attempts.push(mediaFileId),
      beforeCreated: async () => {
        if (attempts.length === 1) {
          creationStarted.resolve()
          await creationResponse.promise
        }
      },
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { user, unmount } = renderWithProviders(<Player mediaFileId="abcd" />)
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await creationStarted.promise

    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    vi.useRealTimers()
    expect(screen.getByRole('alert')).toHaveTextContent('Playback is taking too long to start.')
    expect(hls.attachMedia).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Retry playback' }))
    expect(attempts).toEqual(['abcd'])
    creationResponse.resolve()

    await attachedVideo()
    expect(hls.attachMedia).toHaveBeenCalledOnce()
    expect(attempts).toEqual(['abcd', 'abcd'])
    expect(activeSessions).toEqual(new Set(['sess-abcd']))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    unmount()
    await waitFor(() => expect(activeSessions.size).toBe(0))
  })

  it('shouldWaitForThePreviousMountToReleaseItsSessionBeforeReturningToPlayback', async () => {
    const destructionStarted = deferred()
    const destructionResponse = deferred()
    const activeSessions = serveSingleWorkerSlot({
      beforeDestroyed: async () => {
        destructionStarted.resolve()
        await destructionResponse.promise
      },
    })
    const { user, unmount } = renderWithProviders(<RemountHarness />)
    await attachedVideo()

    await user.click(screen.getByRole('button', { name: 'Leave playback' }))
    await destructionStarted.promise
    await user.click(screen.getByRole('button', { name: 'Return to playback' }))
    destructionResponse.resolve()

    await waitFor(() => expect(hls.attachMedia).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(activeSessions).toEqual(new Set(['sess-abcd']))
    unmount()
    await waitFor(() => expect(activeSessions.size).toBe(0))
  })

  it('shouldStartPlaybackWithOneWorkerSlotWhenStrictModeRestartsTheEffect', async () => {
    configure({ reactStrictMode: true })
    const started = deferred()
    const response = deferred()
    const activeSessions = serveSingleWorkerSlot({
      beforeCreated: async () => {
        started.resolve()
        await response.promise
      },
    })

    const { unmount } = renderWithProviders(<Player mediaFileId="abcd" />)
    await started.promise
    await act(async () => response.resolve())

    await attachedVideo()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(activeSessions).toEqual(new Set(['sess-abcd']))

    unmount()
    await waitFor(() => expect(activeSessions.size).toBe(0))
  })

  it('shouldWaitForCancelledCreationAndDestructionBeforeStartingTheNextMediaFile', async () => {
    const creationStarted = deferred()
    const creationResponse = deferred()
    const destructionStarted = deferred()
    const destructionResponse = deferred()
    const activeSessions = serveSingleWorkerSlot({
      beforeCreated: async (mediaFileId) => {
        if (mediaFileId === 'a') {
          creationStarted.resolve()
          await creationResponse.promise
        }
      },
      beforeDestroyed: async () => {
        destructionStarted.resolve()
        await destructionResponse.promise
      },
    })
    const { user, unmount } = renderWithProviders(<Harness />)
    await creationStarted.promise

    await user.click(screen.getByRole('button', { name: 'Next' }))
    creationResponse.resolve()
    await destructionStarted.promise
    expect(hls.loadSource).not.toHaveBeenCalled()
    destructionResponse.resolve()

    await waitFor(() =>
      expect(hls.loadSource).toHaveBeenCalledExactlyOnceWith(
        '/api/stream/b/multivariant.m3u8?t=playback-token',
      ),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(activeSessions).toEqual(new Set(['sess-b']))

    unmount()
    await waitFor(() => expect(activeSessions.size).toBe(0))
  })

  it('shouldReleaseThePlayingSessionAfterItsFinalReportBeforeStartingTheNextMediaFile', async () => {
    const reportStarted = deferred()
    const reportResponse = deferred()
    const destructionStarted = deferred()
    const destructionResponse = deferred()
    const saved: TimelineReport[] = []
    const activeSessions = serveSingleWorkerSlot({
      beforeDestroyed: async () => {
        destructionStarted.resolve()
        await destructionResponse.promise
      },
    })
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', async ({ variables }) => {
        reportStarted.resolve()
        await reportResponse.promise
        saved.push(variables as unknown as TimelineReport)
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
    )
    const { user, unmount } = renderWithProviders(<Harness />)
    const video = await attachedVideo('/api/stream/a/multivariant.m3u8?t=playback-token')
    playheadAt(video, 5)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await reportStarted.promise
    expect(activeSessions).toEqual(new Set(['sess-a']))
    reportResponse.resolve()
    await destructionStarted.promise
    expect(saved).toEqual([{ sessionId: 'sess-a', positionSeconds: 5, state: 'STOPPED' }])
    destructionResponse.resolve()

    await waitFor(() =>
      expect(hls.loadSource).toHaveBeenLastCalledWith(
        '/api/stream/b/multivariant.m3u8?t=playback-token',
      ),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(activeSessions).toEqual(new Set(['sess-b']))

    unmount()
    await waitFor(() => expect(activeSessions.size).toBe(0))
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
    failSessionCreation()

    renderWithProviders(<Player mediaFileId="abcd" />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('shouldShowTheServersRefusalWhenTheSessionIsRefused', async () => {
    refuseSession()

    renderWithProviders(<Player mediaFileId="abcd" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(CAPACITY_REFUSAL)
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

    raiseHlsFatalError()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(hls.destroy).toHaveBeenCalled()
  })

  it('shouldShowThePlaybackErrorWhenTheNativeElementCannotPlayTheStream', async () => {
    hls.supported = false
    serveSession()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await nativeVideo()

    fireEvent(video, new Event('error'))
    await act(async () => vi.advanceTimersByTimeAsync(30_000))

    vi.useRealTimers()
    expect(screen.getByRole('alert')).toHaveTextContent("Playback couldn't start.")
    expect(screen.getByRole('button', { name: 'Retry playback' })).toBeInTheDocument()
  })

  it('shouldIgnoreTheFailedAttemptsNativeErrorsWhileRetrying', async () => {
    hls.supported = false
    const retryResponse = deferred()
    let creations = 0
    server.use(
      graphql.mutation('CreateStreamSession', async () => {
        creations += 1
        if (creations > 1) {
          await retryResponse.promise
        }
        return HttpResponse.json({
          data: { createStreamSession: { session: SESSION, userErrors: [] } },
        })
      }),
    )
    const { user } = renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await nativeVideo()
    fireEvent(video, new Event('error'))
    await user.click(await screen.findByRole('button', { name: 'Retry playback' }))
    await waitFor(() => expect(creations).toBe(2))

    fireEvent(video, new Event('error'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    retryResponse.resolve()

    await nativeVideo()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldReportTheLastPositionWhenLeavingAfterANativePlaybackError', async () => {
    hls.supported = false
    const reports = serveSession()
    const { unmount } = renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await nativeVideo()
    playheadAt(video, 25)
    fireEvent(video, new Event('error'))
    await screen.findByRole('alert')

    unmount()

    await waitFor(() => expect(reports.at(-1)?.state).toBe('STOPPED'))
    expect(reports).toEqual([
      { sessionId: 'sess-1', positionSeconds: 25, state: 'PLAYING' },
      { sessionId: 'sess-1', positionSeconds: 25, state: 'STOPPED' },
    ])
  })

  it.each(STREAM_PATHS)(
    'shouldTimeOutStartupWhenTheStreamNeverLoadsMetadataOnThe%s',
    async (_path, { supported, streamingVideo, failStream, expectStreamReleased }) => {
      hls.supported = supported
      const activeSessions = serveSingleWorkerSlot()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await streamingVideo()

      await act(async () => vi.advanceTimersByTimeAsync(30_000))
      vi.useRealTimers()

      expect(screen.getByRole('alert')).toHaveTextContent('Playback is taking too long to start.')
      expectStreamReleased(video)
      await waitFor(() => expect(activeSessions.size).toBe(0))
      failStream(video)
      expect(screen.getByRole('alert')).toHaveTextContent('Playback is taking too long to start.')
    },
  )

  it.each(STREAM_PATHS)(
    'shouldKeepTheStreamPastTheStartupDeadlineOnceMetadataLoadsOnThe%s',
    async (_path, { supported, streamingVideo }) => {
      hls.supported = supported
      serveSession()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await streamingVideo()

      fireEvent(video, new Event('loadedmetadata'))
      await act(async () => vi.advanceTimersByTimeAsync(30_000))

      vi.useRealTimers()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it.each([
    ['Refusal', { serve: refuseSession, message: CAPACITY_REFUSAL }],
    ['FailedCreation', { serve: failSessionCreation, message: "Playback couldn't start." }],
  ] as const)(
    'shouldKeepTheFailureMessagePastTheStartupDeadlineAfterA%s',
    async (_outcome, { serve, message }) => {
      serve()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
      renderWithProviders(<Player mediaFileId="abcd" />)
      expect(await screen.findByRole('alert')).toHaveTextContent(message)

      await act(async () => vi.advanceTimersByTimeAsync(30_000))

      vi.useRealTimers()
      expect(screen.getByRole('alert')).toHaveTextContent(message)
    },
  )

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
