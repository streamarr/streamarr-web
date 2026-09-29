import { deferred } from '../test/deferred'
import { act, cleanup, configure, fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { useState } from 'react'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
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
  server.use(
    graphql.mutation('CreateStreamSession', () =>
      HttpResponse.json({ data: { createStreamSession: { session: SESSION, userErrors: [] } } }),
    ),
  )
  return recordTimelineReports()
}

function recordTimelineReports(): TimelineReport[] {
  const reports: TimelineReport[] = []
  server.use(
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

// jsdom's media element has no timeline and cannot load or play. Own currentTime, readyState and
// paused let tests observe the seek, move the playhead, load the stream and press play; load()
// resets the playhead and ready state as a browser does, and play() and pause() flip paused.
function fakeMedia(video: HTMLVideoElement): HTMLVideoElement {
  Object.defineProperty(video, 'currentTime', { writable: true, value: 0, configurable: true })
  Object.defineProperty(video, 'paused', { writable: true, value: true, configurable: true })
  setDuration(video, Number.NaN)
  setReadyState(video, HTMLMediaElement.HAVE_NOTHING)
  Object.defineProperty(video, 'play', {
    configurable: true,
    value: () => {
      if (video.paused) {
        pressPlay(video)
      }
      return Promise.resolve()
    },
  })
  Object.defineProperty(video, 'pause', {
    configurable: true,
    value: () => {
      if (!video.paused) {
        pressPause(video)
      }
    },
  })
  Object.defineProperty(video, 'load', {
    configurable: true,
    value: () => {
      setReadyState(video, HTMLMediaElement.HAVE_NOTHING)
      if (video.currentTime === 0) {
        return
      }
      video.currentTime = 0
      video.dispatchEvent(new Event('timeupdate'))
    },
  })
  return video
}

function setReadyState(video: HTMLVideoElement, readyState: number) {
  Object.defineProperty(video, 'readyState', { value: readyState, configurable: true })
}

function setDuration(video: HTMLVideoElement, seconds: number) {
  Object.defineProperty(video, 'duration', { value: seconds, configurable: true })
}

function loadDuration(video: HTMLVideoElement, seconds: number) {
  setDuration(video, seconds)
  fireEvent(video, new Event('durationchange'))
}

async function seekableVideo(durationSeconds: number): Promise<HTMLVideoElement> {
  const video = await attachedVideo()
  loadDuration(video, durationSeconds)
  return video
}

// Matches the one element whose whole text reads `text`, across the spans that style its parts.
function wholeText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text
}

function loadMetadata(video: HTMLVideoElement) {
  setReadyState(video, HTMLMediaElement.HAVE_METADATA)
  fireEvent(video, new Event('loadedmetadata'))
}

function loadFirstFrame(video: HTMLVideoElement) {
  setReadyState(video, HTMLMediaElement.HAVE_CURRENT_DATA)
  fireEvent(video, new Event('loadeddata'))
}

function pressPlay(video: HTMLVideoElement) {
  Object.defineProperty(video, 'paused', { writable: true, value: false, configurable: true })
  fireEvent(video, new Event('play'))
}

function pressPause(video: HTMLVideoElement) {
  Object.defineProperty(video, 'paused', { writable: true, value: true, configurable: true })
  fireEvent(video, new Event('pause'))
}

function raiseHlsFatalError() {
  const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
  expect(onError).toBeTypeOf('function')
  act(() => onError?.('hlsError', { fatal: true, type: 'networkError' }))
}

// A browser sends no pointerout from an element that left the document while under the mouse.
function moveMouse(to: Element, from: Element) {
  if (from.isConnected) {
    fireEvent.pointerOut(from, { pointerType: 'mouse', relatedTarget: to })
  }
  fireEvent.pointerOver(to, { pointerType: 'mouse', relatedTarget: from })
  fireEvent.pointerMove(to, { pointerType: 'mouse' })
}

function playheadAt(video: HTMLVideoElement, seconds: number) {
  video.currentTime = seconds
  fireEvent(video, new Event('timeupdate'))
}

interface StreamPath {
  supported: boolean
  streamingVideo: () => Promise<HTMLVideoElement>
  startStream: (video: HTMLVideoElement) => void
  failStream: (video: HTMLVideoElement) => void
  expectStreamReleased: (video: HTMLVideoElement) => void
}

const STREAM_PATHS: [string, StreamPath][] = [
  [
    'NativePath',
    {
      supported: false,
      streamingVideo: nativeVideo,
      startStream: (video) => {
        loadMetadata(video)
        loadFirstFrame(video)
      },
      failStream: (video) => fireEvent(video, new Event('error')),
      expectStreamReleased: (video) => expect(video).not.toHaveAttribute('src'),
    },
  ],
  [
    'HlsJsPath',
    {
      supported: true,
      streamingVideo: attachedVideo,
      startStream: loadMetadata,
      failStream: raiseHlsFatalError,
      expectStreamReleased: () => expect(hls.destroy).toHaveBeenCalledOnce(),
    },
  ],
]

const NATIVE_WAITING_POINTS = [
  ['BeforeMetadata', () => undefined],
  ['AtMetadata', loadMetadata],
] as const

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
    'shouldKeepTheStreamPastTheStartupDeadlineOnceItStartsOnThe%s',
    async (_path, { supported, streamingVideo, startStream }) => {
      hls.supported = supported
      serveSession()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await streamingVideo()

      startStream(video)
      await act(async () => vi.advanceTimersByTimeAsync(30_000))

      vi.useRealTimers()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('shouldTimeOutStartupWhenTheNativeStreamLoadsMetadataButNoFrame', async () => {
    hls.supported = false
    const activeSessions = serveSingleWorkerSlot()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await nativeVideo()

    loadMetadata(video)
    await act(async () => vi.advanceTimersByTimeAsync(30_000))

    vi.useRealTimers()
    expect(screen.getByRole('alert')).toHaveTextContent('Playback is taking too long to start.')
    expect(video).not.toHaveAttribute('src')
    await waitFor(() => expect(activeSessions.size).toBe(0))
  })

  it('shouldKeepTheResumePositionWhenTheNativeStreamTimesOutAfterSeeking', async () => {
    hls.supported = false
    const activeSessions = serveSingleWorkerSlot()
    const reports = recordTimelineReports()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderWithProviders(<Player mediaFileId="abcd" startPositionSeconds={120} />)
    const video = await nativeVideo()
    loadMetadata(video)

    await act(async () => vi.advanceTimersByTimeAsync(30_000))

    vi.useRealTimers()
    await waitFor(() => expect(activeSessions.size).toBe(0))
    expect(reports).toEqual([])
  })

  it.each(NATIVE_WAITING_POINTS)(
    'shouldHoldTheStartupDeadlineWhileTheNativeElementWaitsForTheViewer%s',
    async (_point, reachWaitingPoint) => {
      hls.supported = false
      const activeSessions = serveSingleWorkerSlot()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await nativeVideo()

      reachWaitingPoint(video)
      fireEvent(video, new Event('suspend'))
      await act(async () => vi.advanceTimersByTimeAsync(60_000))

      vi.useRealTimers()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(video).toHaveAttribute('src', STREAM_URL)
      expect(activeSessions).toEqual(new Set(['sess-abcd']))
    },
  )

  it.each(NATIVE_WAITING_POINTS)(
    'shouldRestartTheStartupDeadlineWhenTheViewerPlaysTheNativeElementWaiting%s',
    async (_point, reachWaitingPoint) => {
      hls.supported = false
      const activeSessions = serveSingleWorkerSlot()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await nativeVideo()
      reachWaitingPoint(video)
      fireEvent(video, new Event('suspend'))
      await act(async () => vi.advanceTimersByTimeAsync(60_000))

      pressPlay(video)
      await act(async () => vi.advanceTimersByTimeAsync(29_999))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await act(async () => vi.advanceTimersByTimeAsync(1))

      vi.useRealTimers()
      expect(screen.getByRole('alert')).toHaveTextContent('Playback is taking too long to start.')
      expect(video).not.toHaveAttribute('src')
      await waitFor(() => expect(activeSessions.size).toBe(0))
    },
  )

  it.each(NATIVE_WAITING_POINTS)(
    'shouldTimeOutStartupWhenTheNativeElementSuspendsAfterTheViewerPlaysWaiting%s',
    async (_point, reachWaitingPoint) => {
      hls.supported = false
      const activeSessions = serveSingleWorkerSlot()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await nativeVideo()
      reachWaitingPoint(video)
      fireEvent(video, new Event('suspend'))
      pressPlay(video)

      fireEvent(video, new Event('suspend'))
      await act(async () => vi.advanceTimersByTimeAsync(30_000))

      vi.useRealTimers()
      expect(screen.getByRole('alert')).toHaveTextContent('Playback is taking too long to start.')
      expect(video).not.toHaveAttribute('src')
      await waitFor(() => expect(activeSessions.size).toBe(0))
    },
  )

  it('shouldHoldTheStartupDeadlineWhenTheViewerPausesTheNativeElementBeforeItsFirstFrame', async () => {
    hls.supported = false
    const activeSessions = serveSingleWorkerSlot()
    recordTimelineReports()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await nativeVideo()
    loadMetadata(video)
    pressPlay(video)
    pressPause(video)

    fireEvent(video, new Event('suspend'))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))

    vi.useRealTimers()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(video).toHaveAttribute('src', STREAM_URL)
    expect(activeSessions).toEqual(new Set(['sess-abcd']))
  })

  it('shouldNotRestartTheStartupDeadlineWhenTheViewerPlaysALoadedNativeStream', async () => {
    hls.supported = false
    serveSession()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await nativeVideo()

    loadMetadata(video)
    loadFirstFrame(video)
    fireEvent(video, new Event('suspend'))
    pressPlay(video)
    await act(async () => vi.advanceTimersByTimeAsync(60_000))

    vi.useRealTimers()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldNotTimeOutTheNextMediaFileWhenThePreviousOneNeverStarted', async () => {
    serveSingleWorkerSlot()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderWithProviders(<Harness />)
    await attachedVideo('/api/stream/a/multivariant.m3u8?t=playback-token')
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await attachedVideo('/api/stream/b/multivariant.m3u8?t=playback-token')

    await act(async () => vi.advanceTimersByTimeAsync(20_000))

    vi.useRealTimers()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

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

    loadMetadata(video)

    expect(video.currentTime).toBe(120)
  })

  it('shouldStartFromTheBeginningWhenNoStartPositionIsGiven', async () => {
    serveSession()
    renderWithProviders(<Player mediaFileId="abcd" />)
    const video = await attachedVideo()

    loadMetadata(video)

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

  describe('controls', () => {
    afterEach(() => {
      for (const property of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) {
        Reflect.deleteProperty(document, property)
      }
    })

    it('shouldHandPlaybackToTheControlBarInsteadOfTheBrowserControls', async () => {
      serveSession()
      renderWithProviders(<Player mediaFileId="abcd" />)
      expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()

      const video = await attachedVideo()

      expect(video).not.toHaveAttribute('controls')
      expect(video).toHaveAttribute('playsinline')
      expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
    })

    it('shouldPlayAndPauseFromTheRoundButton', async () => {
      serveSession()
      const { user } = renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()

      await user.click(screen.getByRole('button', { name: 'Play' }))
      expect(video.paused).toBe(false)

      await user.click(screen.getByRole('button', { name: 'Pause' }))
      expect(video.paused).toBe(true)
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    })

    it('shouldHoldSeekingUntilTheDurationIsKnown', async () => {
      serveSession()
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Forward 10 seconds' })).toBeDisabled()
      expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-disabled', 'true')

      loadDuration(video, 2824)

      expect(screen.getByRole('button', { name: 'Back 10 seconds' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Forward 10 seconds' })).toBeEnabled()
      expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-disabled', 'false')
    })

    it('shouldSkipTenSecondsWithinTheVideo', async () => {
      serveSession()
      const { user } = renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await seekableVideo(45)
      playheadAt(video, 30)

      await user.click(screen.getByRole('button', { name: 'Forward 10 seconds' }))
      expect(video.currentTime).toBe(40)
      await user.click(screen.getByRole('button', { name: 'Forward 10 seconds' }))
      expect(video.currentTime).toBe(45)

      playheadAt(video, 4)
      await user.click(screen.getByRole('button', { name: 'Back 10 seconds' }))
      expect(video.currentTime).toBe(0)
    })

    it('shouldSeekFromTheSeekSliderByKeyboardWithoutPausing', async () => {
      const reports = serveSession()
      const { user } = renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await seekableVideo(2824)
      await user.click(screen.getByRole('button', { name: 'Play' }))
      playheadAt(video, 30)
      const seek = screen.getByRole('slider', { name: 'Seek' })
      expect(seek).toHaveAttribute('aria-valuetext', '0:30 of 47:04')

      act(() => seek.focus())
      await user.keyboard('{ArrowRight}')
      expect(video.currentTime).toBe(31)
      await user.keyboard('{End}')
      expect(video.currentTime).toBe(2824)

      expect(video.paused).toBe(false)
      expect(reports.filter((report) => report.state === 'PAUSED')).toEqual([])
    })

    it('shouldPauseWhileScrubbingAndSeekOnRelease', async () => {
      serveSession()
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        ...{ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 20, width: 1000, height: 20 },
        toJSON: () => ({}),
      })
      const { user } = renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await seekableVideo(2000)
      await user.click(screen.getByRole('button', { name: 'Play' }))
      const seek = screen.getByRole('slider', { name: 'Seek' })

      await user.pointer({ keys: '[MouseLeft>]', target: seek, coords: { clientX: 250 } })
      expect(video.paused).toBe(true)
      expect(await screen.findByText('8:20 / 33:20')).toBeInTheDocument()
      expect(video.currentTime).toBe(0)

      await user.pointer({ keys: '[/MouseLeft]', target: seek })
      await waitFor(() => expect(video.currentTime).toBe(500))
      expect(video.paused).toBe(false)
    })

    it('shouldMuteAndSetTheVolume', async () => {
      serveSession()
      const { user } = renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      const volume = screen.getByRole('slider', { name: 'Volume' })
      expect(volume).toHaveAttribute('aria-valuetext', '100%')

      await user.click(screen.getByRole('button', { name: 'Mute' }))
      expect(video.muted).toBe(true)
      expect(volume).toHaveAttribute('aria-valuetext', '0%')

      await user.click(screen.getByRole('button', { name: 'Unmute' }))
      expect(video.muted).toBe(false)
      act(() => volume.focus())
      await user.keyboard('{ArrowLeft}')
      expect(video.volume).toBe(0.95)
      expect(volume).toHaveAttribute('aria-valuetext', '95%')
    })

    it('shouldRestoreFullVolumeWhenUnmutingFromZero', async () => {
      serveSession()
      const { user } = renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      act(() => screen.getByRole('slider', { name: 'Volume' }).focus())

      await user.keyboard('{Home}')
      expect(video.volume).toBe(0)
      await user.click(screen.getByRole('button', { name: 'Unmute' }))

      expect(video.volume).toBe(1)
      expect(video.muted).toBe(false)
      expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument()
    })

    it('shouldShowTheQualityInUseOnAStatusChipThatOpensNothing', async () => {
      serveSession()
      const { user } = renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      expect(screen.getByRole('button', { name: 'Quality: Auto' })).toHaveTextContent(/^Auto$/)

      Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true })
      fireEvent(video, new Event('resize'))

      const chip = screen.getByRole('button', { name: 'Quality: Auto · 720p' })
      expect(chip).toHaveTextContent(/^Auto · 720p$/)
      expect(chip).toHaveAttribute('aria-disabled', 'true')
      await user.click(chip)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('shouldEnterAndLeaveFullScreenOnThePlayer', async () => {
      serveSession()
      const exitFullscreen = vi.fn(() => Promise.resolve())
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: exitFullscreen,
      })
      const { user } = renderWithProviders(<Player mediaFileId="abcd" />)
      const player = screen.getByRole('region', { name: 'Player' })
      const requestFullscreen = vi.fn(() => Promise.resolve())
      Object.defineProperty(player, 'requestFullscreen', { value: requestFullscreen })

      await user.click(screen.getByRole('button', { name: 'Full screen' }))
      expect(requestFullscreen).toHaveBeenCalledOnce()

      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: player })
      fireEvent(document, new Event('fullscreenchange'))
      await user.click(screen.getByRole('button', { name: 'Exit full screen' }))
      expect(exitFullscreen).toHaveBeenCalledOnce()
    })

    it('shouldOfferNoFullScreenWhereTheBrowserCannotGiveIt', async () => {
      serveSession()
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false })
      renderWithProviders(<Player mediaFileId="abcd" />)
      await attachedVideo()

      expect(screen.getByRole('region', { name: 'Player' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Full screen' })).not.toBeInTheDocument()
    })

    it('shouldFadeTheControlsAfterThreeSecondsOfPlaybackUntilThePointerOrKeyboardWakesThem', async () => {
      serveSession()
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      const player = screen.getByRole('region', { name: 'Player' })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await act(() => video.play())

      await act(async () => vi.advanceTimersByTimeAsync(2_999))
      expect(player).not.toHaveAttribute('data-idle')
      await act(async () => vi.advanceTimersByTimeAsync(1))
      expect(player).toHaveAttribute('data-idle')

      fireEvent.pointerMove(document)
      expect(player).not.toHaveAttribute('data-idle')
      await act(async () => vi.advanceTimersByTimeAsync(3_000))
      expect(player).toHaveAttribute('data-idle')

      fireEvent.keyDown(document, { key: 'Shift' })
      expect(player).not.toHaveAttribute('data-idle')
    })

    it('shouldKeepTheControlsWhilePausedOrWhileTheMouseRestsOnTheBar', async () => {
      serveSession()
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      const player = screen.getByRole('region', { name: 'Player' })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(player).not.toHaveAttribute('data-idle')

      moveMouse(screen.getByRole('button', { name: 'Play' }), video)
      await act(() => video.play())
      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(player).not.toHaveAttribute('data-idle')

      moveMouse(video, screen.getByRole('button', { name: 'Pause' }))
      await act(async () => vi.advanceTimersByTimeAsync(3_000))
      expect(player).toHaveAttribute('data-idle')
    })

    it('shouldFadeTheControlsOnceTheMouseLeavesTheBarAfterTheGlyphUnderItWasReplaced', async () => {
      serveSession()
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const playGlyph = screen.getByRole('button', { name: 'Play' }).querySelector('svg')
      assert(playGlyph)
      moveMouse(playGlyph, video)
      await act(() => video.play())
      expect(playGlyph.isConnected).toBe(false)

      moveMouse(video, playGlyph)
      await act(async () => vi.advanceTimersByTimeAsync(3_000))

      expect(screen.getByRole('region', { name: 'Player' })).toHaveAttribute('data-idle')
    })

    it('shouldFadeTheControlsOnceTheMouseLeavesTheWindowFromTheBar', async () => {
      serveSession()
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      moveMouse(screen.getByRole('button', { name: 'Play' }), video)
      await act(() => video.play())
      await act(async () => vi.advanceTimersByTimeAsync(3_000))

      fireEvent.pointerOut(screen.getByRole('button', { name: 'Pause' }), {
        pointerType: 'mouse',
        relatedTarget: null,
      })
      await act(async () => vi.advanceTimersByTimeAsync(3_000))

      expect(screen.getByRole('region', { name: 'Player' })).toHaveAttribute('data-idle')
    })

    it('shouldKeepBackOnScreenWhileAPlaybackFailureShows', async () => {
      serveSession()
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await act(() => video.play())
      raiseHlsFatalError()

      await act(async () => vi.advanceTimersByTimeAsync(10_000))

      expect(screen.getByRole('alert')).toBeInTheDocument()

      expect(screen.getByRole('region', { name: 'Player' })).not.toHaveAttribute('data-idle')
      expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
    })

    it('shouldShowTheBufferingRingWhileThePlayingVideoWaitsForData', async () => {
      serveSession()
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      setReadyState(video, HTMLMediaElement.HAVE_FUTURE_DATA)
      await act(() => video.play())
      expect(screen.queryByRole('progressbar', { name: 'Buffering' })).not.toBeInTheDocument()

      setReadyState(video, HTMLMediaElement.HAVE_CURRENT_DATA)
      fireEvent(video, new Event('waiting'))
      expect(screen.getByRole('progressbar', { name: 'Buffering' })).toBeInTheDocument()

      setReadyState(video, HTMLMediaElement.HAVE_ENOUGH_DATA)
      fireEvent(video, new Event('playing'))
      expect(screen.queryByRole('progressbar', { name: 'Buffering' })).not.toBeInTheDocument()

      setReadyState(video, HTMLMediaElement.HAVE_CURRENT_DATA)
      fireEvent(video, new Event('waiting'))
      act(() => video.pause())
      expect(screen.queryByRole('progressbar', { name: 'Buffering' })).not.toBeInTheDocument()
    })

    it('shouldShowTheTimecodeAndTitleInTheTitleLine', async () => {
      serveSession()
      renderWithProviders(
        <Player
          mediaFileId="abcd"
          title={{ heading: 'Northern Line', detail: 'S2 E5 — Breakage' }}
        />,
      )
      const video = await seekableVideo(2824)

      playheadAt(video, 1392)

      expect(screen.getByText('Northern Line')).toBeInTheDocument()
      expect(screen.getByText(wholeText('S2 E5 — Breakage · 23:12 / 47:04'))).toBeInTheDocument()
    })

    it('shouldShowTheTimecodeAloneOnceTheDurationIsKnownWithoutATitle', async () => {
      serveSession()
      renderWithProviders(<Player mediaFileId="abcd" />)
      const video = await attachedVideo()
      expect(screen.queryByText(/ \/ /)).not.toBeInTheDocument()

      loadDuration(video, 2824)

      expect(screen.getByText('0:00 / 47:04')).toBeInTheDocument()
    })
  })
})
