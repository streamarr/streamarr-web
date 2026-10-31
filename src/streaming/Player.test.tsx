import { readyPlaybackSession, destroyedPlaybackSession } from '../test/playbackSession'
import { useApolloClient } from '@apollo/client/react'
import { deferred } from '../test/deferred'
import { act, cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { HttpResponse, graphql } from 'msw'
import { useEffect, useState } from 'react'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
import { type FakeHlsTrack, hls, resetFakeHls } from '../test/fakeHls'
import {
  fakeNetworkLoader,
  forwardBuffer,
  hlsConfigWith,
  segmentCallbacks,
  segmentContext,
  segmentLoadConfiguration,
} from '../test/fakeNetworkLoader'
import { type FakeAudioTrack, type FakeTextTrack, giveElementTracks } from '../test/mediaTracks'
import {
  IPHONE_SAFARI_HEVC_ANSWER,
  IPHONE_SAFARI_USER_AGENT,
  MINIMAL_DECLARATION,
  playbackPlatformFixture,
  smoothUpToFullHd,
} from '../test/playbackCapabilities'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import type { ClientCapabilityDeclarationInput } from '../graphql/generated/graphql'
import type { PlaybackPlatform } from './playbackCapabilities'
import { Player } from './Player'

vi.mock('hls.js', async () => (await import('../test/fakeHls')).hlsModule)

const withoutDecodingInfo = () => playbackPlatformFixture()
const STREAM_URL = '/api/stream/abcd/multivariant.m3u8?t=playback-token'
const SESSION = { id: 'sess-1', streamUrl: STREAM_URL, transcodeMode: 'REMUX' } as const
const DECLARATION_REFUSAL = 'capabilities.video[0].maxWidth must be above zero.'
const CAPACITY_REFUSAL = 'Every transcode slot is busy. Try again in a moment.'
const INVALID_PLAN =
  "This video can't be played right now. Ask your server admin to check the server logs."
const FAILED_ATTEMPT_ERRORS = [
  {
    error: { __typename: 'PlaybackInvalidSpecificationError', message: INVALID_PLAN },
    shown: INVALID_PLAN,
  },
  {
    error: { __typename: 'PlaybackFutureFailureError', message: 'A failure added later.' },
    shown: 'A failure added later.',
  },
  {
    error: { __typename: 'PlaybackFutureFailureError' },
    shown: "This video can't be played right now. Try again later.",
  },
]

function failedPlaybackSession(error: { __typename: string; message?: string }) {
  return {
    ...readyPlaybackSession({ streamSession: SESSION }),
    currentFormatAttempt: {
      __typename: 'FailedPlaybackFormatAttempt',
      streamSessionId: SESSION.id,
      error,
    },
  }
}

interface TimelineReport {
  sessionId: string
  positionSeconds: number
  state: string
}

function serveSession(): TimelineReport[] {
  server.use(
    graphql.mutation('CreatePlaybackSession', () =>
      HttpResponse.json({
        data: {
          createPlaybackSession: {
            playbackSession: readyPlaybackSession({ streamSession: SESSION }),
            userErrors: [],
          },
        },
      }),
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

function refuseTheFirstStoppedReport(reports: TimelineReport[]): () => boolean {
  let refused = false
  server.use(
    graphql.mutation('ReportStreamSessionTimeline', ({ variables }) => {
      reports.push(variables as unknown as TimelineReport)
      if (variables.state === 'STOPPED' && !refused) {
        refused = true
        return HttpResponse.json({ errors: [{ message: 'Temporarily unavailable' }] })
      }
      return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
    }),
  )
  return () => refused
}

function refuseSession() {
  server.use(
    graphql.mutation('CreatePlaybackSession', () =>
      HttpResponse.json({
        data: {
          createPlaybackSession: {
            playbackSession: null,
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
    graphql.mutation('CreatePlaybackSession', () =>
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
    graphql.mutation('CreatePlaybackSession', async ({ variables }) => {
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
      const playbackSession = readyPlaybackSession({ streamSession: session })
      activeSessions.add(playbackSession.id)
      await beforeCreated?.(mediaFileId)
      return HttpResponse.json({
        data: { createPlaybackSession: { playbackSession, userErrors: [] } },
      })
    }),
    graphql.mutation('DestroyPlaybackSession', async ({ variables }) => {
      await beforeDestroyed?.()
      activeSessions.delete(destroyedPlaybackSession(variables).playbackSessionId)
      return HttpResponse.json({
        data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
      })
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
// resets the element as a browser does, firing emptied but no pause, and play() and pause() flip
// paused.
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
      const rewound = video.currentTime !== 0
      Object.defineProperty(video, 'paused', { writable: true, value: true, configurable: true })
      setReadyState(video, HTMLMediaElement.HAVE_NOTHING)
      setDuration(video, Number.NaN)
      video.currentTime = 0
      video.dispatchEvent(new Event('emptied'))
      if (rewound) {
        video.dispatchEvent(new Event('timeupdate'))
      }
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

// The replacement is a plain function that counts its calls. A vi.fn handles every promise it
// returns, so Vitest would miss a refusal that the player leaves uncaught.
function replacePlay(video: HTMLVideoElement, answer: () => Promise<void>): { calls: number } {
  const play = { calls: 0 }
  Object.defineProperty(video, 'play', {
    configurable: true,
    value: () => {
      play.calls += 1
      return answer()
    },
  })
  return play
}

// A browser's autoplay policy refuses play() until the viewer has interacted with the page.
function refuseToStartPlayback(video: HTMLVideoElement) {
  return replacePlay(video, () =>
    Promise.reject(new DOMException('No user activation', 'NotAllowedError')),
  )
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

async function playUntilFaded(video: HTMLVideoElement) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await act(() => video.play())
  await act(async () => vi.advanceTimersByTimeAsync(3_000))
}

// A browser follows a tap with mouse events unless its pointerdown was cancelled, and finds their
// target afresh: once the tap has woken the faded controls, they land on the control it uncovered.
function tap(target: Element, { mouseTarget = target, clientX = 0 } = {}) {
  const followedByMouseEvents = fireEvent.pointerDown(target, { pointerType: 'touch', clientX })
  fireEvent.pointerUp(target, { pointerType: 'touch', clientX })
  if (followedByMouseEvents) {
    fireEvent.mouseDown(mouseTarget, { clientX })
    fireEvent.mouseUp(mouseTarget, { clientX })
  }
  fireEvent.click(mouseTarget, { clientX })
}

// Mantine's slider follows a finger through touch events; the controls watch its pointer events.
function touchDown(target: Element, clientX = 0) {
  fireEvent.pointerDown(target, { pointerType: 'touch', clientX })
  fireEvent.touchStart(target, { changedTouches: [{ clientX, clientY: 10 }] })
}

function liftTouch(target: Element) {
  fireEvent.pointerUp(target, { pointerType: 'touch' })
  fireEvent.touchEnd(target)
}

// The browser takes a touch back when, say, a system gesture or an incoming call claims it.
function cancelTouch(target: Element) {
  fireEvent.pointerCancel(target, { pointerType: 'touch' })
  fireEvent.touchCancel(target)
}

// Mantine's slider moves to where a drag has reached on the next animation frame.
async function nextAnimationFrame() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
}

// jsdom lays nothing out; the seek slider turns a pointer's x into a position across 1000 pixels.
function layOutSeekTrack() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    ...{ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 20, width: 1000, height: 20 },
    toJSON: () => ({}),
  })
}

function playheadAt(video: HTMLVideoElement, seconds: number) {
  video.currentTime = seconds
  fireEvent(video, new Event('timeupdate'))
}

function offerHlsTracks({
  audio = [],
  audioTrack = -1,
  subtitles = [],
  subtitleTrack = -1,
}: {
  audio?: FakeHlsTrack[]
  audioTrack?: number
  subtitles?: FakeHlsTrack[]
  subtitleTrack?: number
}) {
  hls.audioTracks = audio
  hls.audioTrack = audioTrack
  hls.subtitleTracks = subtitles
  hls.subtitleTrack = subtitleTrack
  act(() => {
    hls.emit('hlsAudioTracksUpdated')
    hls.emit('hlsSubtitleTracksUpdated')
  })
}

async function openPicker(user: UserEvent, chip: HTMLElement): Promise<HTMLElement> {
  await user.click(chip)
  return screen.getByRole('menu')
}

function renderedVideo(): HTMLVideoElement {
  const video = document.querySelector('video')
  assert(video, 'no video element rendered')
  return video
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

// Once it has metadata, the element waits for the viewer only when the browser refused to start it.
const NATIVE_WAITING_POINTS = [
  ['BeforeMetadata', () => undefined],
  [
    'AtMetadata',
    (video: HTMLVideoElement) => {
      refuseToStartPlayback(video)
      loadMetadata(video)
    },
  ],
] as const

// A browser that reaches the end fires timeupdate, then pause, then ended.
function playedToTheEnd(video: HTMLVideoElement, durationSeconds: number) {
  playheadAt(video, durationSeconds)
  fireEvent(video, new Event('pause'))
  fireEvent(video, new Event('ended'))
}

function Harness({
  playbackPlatform = withoutDecodingInfo,
}: Readonly<{ playbackPlatform?: () => PlaybackPlatform }>) {
  const [mediaFileId, setMediaFileId] = useState('a')
  return (
    <>
      <button type="button" onClick={() => setMediaFileId('b')}>
        Next
      </button>
      <Player playbackPlatform={playbackPlatform} mediaFileId={mediaFileId} />
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
      {shown && <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />}
    </>
  )
}

describe('Player', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetFakeHls()
    server.use(
      graphql.mutation('DestroyPlaybackSession', ({ variables }) =>
        HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        }),
      ),
    )
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => cleanup())
    configure({ reactStrictMode: false })
  })

  it('shouldOwnOneLogicalPlaybackSessionWhenItsReadyStreamIsAttached', async () => {
    serveSession()
    const created: unknown[] = []
    const destroyed: unknown[] = []
    server.use(
      graphql.mutation('CreatePlaybackSession', ({ variables }) => {
        created.push(variables)
        return HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: {
                id: 'playback-1',
                formatAttemptCount: 1,
                maximumFormatAttempts: 3,
                currentFormatAttempt: {
                  __typename: 'ReadyPlaybackFormatAttempt',
                  streamSession: SESSION,
                },
              },
              userErrors: [],
            },
          },
        })
      }),
      graphql.mutation('DestroyPlaybackSession', ({ variables }) => {
        destroyed.push(variables)
        return HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        })
      }),
    )
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )

    await attachedVideo()
    expect(created).toEqual([{ input: { mediaFileId: 'abcd', capabilities: MINIMAL_DECLARATION } }])
    unmount()
    await waitFor(() => expect(destroyed).toEqual([{ input: { playbackSessionId: 'playback-1' } }]))
  })

  it('shouldWaitForAStartingVariantWithinItsOwnForwardBufferWhenHlsLoadsASegment', async () => {
    serveSession()
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    await attachedVideo()
    hls.mainForwardBufferInfo = forwardBuffer(30)
    const network = fakeNetworkLoader()
    const config = hlsConfigWith(hls.config ?? {}, network)
    const SegmentLoader = config.fLoader
    assert(SegmentLoader)

    new SegmentLoader(config).load(segmentContext(), segmentLoadConfiguration(), segmentCallbacks())

    expect(network.loads.map(({ config }) => config.loadPolicy.maxTimeToFirstByteMs)).toEqual([
      20_000,
    ])
  })

  it('shouldDeclareWhatTheBrowserDecodesWhenPlaybackStarts', async () => {
    serveSession()
    const created: { input: { capabilities: ClientCapabilityDeclarationInput } }[] = []
    server.use(
      graphql.mutation('CreatePlaybackSession', ({ variables }) => {
        created.push(variables as unknown as (typeof created)[number])
        return HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: readyPlaybackSession({ streamSession: SESSION }),
              userErrors: [],
            },
          },
        })
      }),
    )
    const decodingInfo = (configuration: MediaDecodingConfiguration) => {
      const supported = !configuration.video?.contentType.includes('av01')
      return Promise.resolve({ supported, smooth: supported, powerEfficient: supported })
    }

    renderWithProviders(
      <Player
        playbackPlatform={() => playbackPlatformFixture({ decodingInfo })}
        mediaFileId="abcd"
      />,
    )
    await attachedVideo()

    expect(
      created.map(({ input }) => input.capabilities.video.map((entry) => entry.codecFamily)),
    ).toEqual([['H264', 'HEVC']])
  })

  it('shouldDeclareHevcWhenIphoneSafariDecodesItPowerEfficientlyWithoutASmoothAnswer', async () => {
    serveSession()
    const created: { input: { capabilities: ClientCapabilityDeclarationInput } }[] = []
    server.use(
      graphql.mutation('CreatePlaybackSession', ({ variables }) => {
        created.push(variables as unknown as (typeof created)[number])
        return HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: readyPlaybackSession({ streamSession: SESSION }),
              userErrors: [],
            },
          },
        })
      }),
    )
    const decodingInfo = (configuration: MediaDecodingConfiguration) => {
      if (configuration.video?.contentType.includes('hvc1')) {
        return Promise.resolve(IPHONE_SAFARI_HEVC_ANSWER)
      }
      return Promise.resolve({ supported: true, smooth: true, powerEfficient: true })
    }

    renderWithProviders(
      <Player
        playbackPlatform={() =>
          playbackPlatformFixture({ decodingInfo, userAgent: IPHONE_SAFARI_USER_AGENT })
        }
        mediaFileId="abcd"
      />,
    )
    await attachedVideo()

    expect(
      created.map(({ input }) => input.capabilities.video.map((entry) => entry.codecFamily)),
    ).toEqual([['H264', 'HEVC', 'AV1']])
  })

  it('shouldCapPowerEfficientHevcAtTheHighestTierH264KeepsUpWithWhenIphoneSafariPlays', async () => {
    serveSession()
    const created: { input: { capabilities: ClientCapabilityDeclarationInput } }[] = []
    server.use(
      graphql.mutation('CreatePlaybackSession', ({ variables }) => {
        created.push(variables as unknown as (typeof created)[number])
        return HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: readyPlaybackSession({ streamSession: SESSION }),
              userErrors: [],
            },
          },
        })
      }),
    )
    const decodingInfo = (configuration: MediaDecodingConfiguration) => {
      if (configuration.video?.contentType.includes('hvc1')) {
        return Promise.resolve(IPHONE_SAFARI_HEVC_ANSWER)
      }
      return Promise.resolve(smoothUpToFullHd(configuration))
    }

    renderWithProviders(
      <Player
        playbackPlatform={() =>
          playbackPlatformFixture({ decodingInfo, userAgent: IPHONE_SAFARI_USER_AGENT })
        }
        mediaFileId="abcd"
      />,
    )
    await attachedVideo()

    expect(
      created.flatMap(({ input }) =>
        input.capabilities.video
          .filter((entry) => entry.codecFamily === 'HEVC')
          .map(({ maxHeight, maxFrameRate, maxBitDepth }) => ({
            maxHeight,
            maxFrameRate,
            maxBitDepth,
          })),
      ),
    ).toEqual([{ maxHeight: 1080, maxFrameRate: 60, maxBitDepth: 10 }])
  })

  it('shouldShowThePlaybackFailureWithoutCreatingASessionWhenTheBrowserDecodesNoVideo', async () => {
    const created: unknown[] = []
    server.use(
      graphql.mutation('CreatePlaybackSession', ({ variables }) => {
        created.push(variables)
        return HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: readyPlaybackSession({ streamSession: SESSION }),
              userErrors: [],
            },
          },
        })
      }),
    )
    const decodingInfo = (configuration: MediaDecodingConfiguration) => {
      const supported = configuration.video === undefined
      return Promise.resolve({ supported, smooth: supported, powerEfficient: supported })
    }

    renderWithProviders(
      <Player
        playbackPlatform={() => playbackPlatformFixture({ decodingInfo })}
        mediaFileId="abcd"
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Playback couldn't start. Try again.",
    )
    expect(created).toEqual([])
    expect(hls.loadSource).not.toHaveBeenCalled()
  })

  it('shouldAttachTheReadyChildWhenInitialPlaybackIsPending', async () => {
    serveSession()
    const queries: unknown[] = []
    server.use(
      graphql.mutation('CreatePlaybackSession', () =>
        HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: {
                ...readyPlaybackSession({ streamSession: SESSION }),
                currentFormatAttempt: {
                  __typename: 'PendingPlaybackFormatAttempt',
                  streamSessionId: SESSION.id,
                },
              },
              userErrors: [],
            },
          },
        }),
      ),
      graphql.query('PlaybackSession', ({ variables }) => {
        queries.push(variables)
        const playbackSession = readyPlaybackSession({ streamSession: SESSION })
        return HttpResponse.json({
          data: {
            playbackSession:
              queries.length === 1
                ? {
                    ...playbackSession,
                    currentFormatAttempt: {
                      __typename: 'PendingPlaybackFormatAttempt',
                      streamSessionId: SESSION.id,
                    },
                  }
                : playbackSession,
          },
        })
      }),
    )

    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)

    await attachedVideo()
    expect(queries).toEqual([{ id: 'playback-sess-1' }, { id: 'playback-sess-1' }])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldShowTheTypedFailureWhenInitialPlaybackHasFailed', async () => {
    server.use(
      graphql.mutation('CreatePlaybackSession', () =>
        HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: {
                ...readyPlaybackSession({ streamSession: SESSION }),
                currentFormatAttempt: {
                  __typename: 'FailedPlaybackFormatAttempt',
                  streamSessionId: SESSION.id,
                  error: {
                    __typename: 'PlaybackOutputMismatchError',
                    message:
                      "This video file can't be played. Ask your server admin to check the file.",
                  },
                },
              },
              userErrors: [],
            },
          },
        }),
      ),
    )

    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This video file can't be played. Ask your server admin to check the file.",
    )
    expect(hls.loadSource).not.toHaveBeenCalled()
  })

  it.each(FAILED_ATTEMPT_ERRORS)(
    'shouldShowAMessageWithoutAttachingWhenTheFirstAttemptFails($error.__typename, $shown)',
    async ({ error, shown }) => {
      server.use(
        graphql.mutation('CreatePlaybackSession', () =>
          HttpResponse.json({
            data: {
              createPlaybackSession: {
                playbackSession: failedPlaybackSession(error),
                userErrors: [],
              },
            },
          }),
        ),
      )

      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)

      expect(await screen.findByRole('alert')).toHaveTextContent(shown)
      expect(hls.loadSource).not.toHaveBeenCalled()
    },
  )

  it.each(FAILED_ATTEMPT_ERRORS)(
    'shouldEndPlaybackWithAMessageWhenTheReplacementAttemptFails($error.__typename, $shown)',
    async ({ error, shown }) => {
      serveSession()
      server.use(
        graphql.mutation('ReportPlaybackFormatFailure', () =>
          HttpResponse.json({
            data: {
              reportPlaybackFormatFailure: {
                playbackSession: {
                  ...readyPlaybackSession({ streamSession: SESSION }),
                  formatAttemptCount: 2,
                  currentFormatAttempt: {
                    __typename: 'PendingPlaybackFormatAttempt',
                    streamSessionId: 'sess-2',
                  },
                },
                userErrors: [],
              },
            },
          }),
        ),
        graphql.query('PlaybackSession', () =>
          HttpResponse.json({ data: { playbackSession: failedPlaybackSession(error) } }),
        ),
      )
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      await attachedVideo()
      const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
      assert(onError)

      act(() =>
        onError('hlsError', {
          fatal: true,
          type: 'mediaError',
          details: 'manifestIncompatibleCodecsError',
        }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(shown)
      expect(hls.destroy).toHaveBeenCalledOnce()
      expect(hls.loadSource).toHaveBeenCalledOnce()
    },
  )

  it.each(FAILED_ATTEMPT_ERRORS)(
    'shouldEndPlaybackWithAMessageWhenRecoveryFromANonFatalStreamErrorFindsTheAttemptFailed($error.__typename, $shown)',
    async ({ error, shown }) => {
      serveSession()
      const failures: unknown[] = []
      server.use(
        graphql.query('PlaybackSession', () =>
          HttpResponse.json({ data: { playbackSession: failedPlaybackSession(error) } }),
        ),
        graphql.mutation('ReportPlaybackFormatFailure', ({ variables }) => {
          failures.push(variables)
          return HttpResponse.json({ errors: [{ message: 'Unexpected format report' }] })
        }),
      )
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      loadMetadata(video)
      const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
      assert(onError)

      act(() =>
        onError('hlsError', { fatal: false, type: 'networkError', response: { code: 503 } }),
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(shown)
      expect(hls.destroy).toHaveBeenCalledOnce()
      expect(hls.loadSource).toHaveBeenCalledOnce()
      expect(failures).toEqual([])
    },
  )

  it.each([true, false])(
    'shouldPreserveSecondsAndPlaybackIntentWhenAFormatIsRejected(%s)',
    async (playing) => {
      const timelineReports = serveSession()
      const failures: unknown[] = []
      let statusQueries = 0
      const nextStream = {
        ...SESSION,
        id: 'sess-2',
        streamUrl: '/api/stream/second/multivariant.m3u8?t=next-token',
      }
      server.use(
        graphql.mutation('ReportPlaybackFormatFailure', ({ variables }) => {
          failures.push(variables)
          return HttpResponse.json({
            data: {
              reportPlaybackFormatFailure: {
                playbackSession: {
                  ...readyPlaybackSession({ streamSession: SESSION }),
                  formatAttemptCount: 2,
                  currentFormatAttempt: {
                    __typename: 'PendingPlaybackFormatAttempt',
                    streamSessionId: 'sess-2',
                  },
                },
                userErrors: [],
              },
            },
          })
        }),
        graphql.query('PlaybackSession', () => {
          statusQueries += 1
          return HttpResponse.json({
            data: {
              playbackSession: {
                ...readyPlaybackSession({ id: 'playback-sess-1', streamSession: nextStream }),
                formatAttemptCount: 2,
              },
            },
          })
        }),
      )
      renderWithProviders(
        <Player
          playbackPlatform={withoutDecodingInfo}
          mediaFileId="abcd"
          startPositionSeconds={12}
        />,
      )
      const video = await attachedVideo()
      loadMetadata(video)
      playheadAt(video, 73.25)
      if (!playing) pressPause(video)
      act(() => {
        video.muted = true
      })
      hls.destroy.mockImplementationOnce(() => video.load())
      const oldError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
      assert(oldError)

      act(() => {
        oldError('hlsError', {
          fatal: true,
          type: 'mediaError',
          details: 'manifestIncompatibleCodecsError',
        })
        oldError('hlsError', {
          fatal: true,
          type: 'mediaError',
          details: 'manifestIncompatibleCodecsError',
        })
      })

      await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(nextStream.streamUrl))
      loadMetadata(video)
      expect(video.currentTime).toBe(73.25)
      expect(video.paused).toBe(!playing)
      expect(video.muted).toBe(true)
      expect(failures).toEqual([
        {
          input: {
            playbackSessionId: 'playback-sess-1',
            streamSessionId: 'sess-1',
            reason: 'UNSUPPORTED_FORMAT',
          },
        },
      ])
      act(() => {
        oldError('hlsError', {
          fatal: true,
          type: 'mediaError',
          details: 'manifestIncompatibleCodecsError',
        })
        oldError('hlsError', { fatal: true, type: 'networkError', response: { code: 503 } })
      })
      playheadAt(video, 85.5)
      await waitFor(() =>
        expect(timelineReports).toContainEqual({
          sessionId: 'sess-2',
          positionSeconds: 85,
          state: 'PLAYING',
        }),
      )
      expect(failures).toHaveLength(1)
      expect(statusQueries).toBe(1)
      expect(timelineReports).not.toContainEqual(expect.objectContaining({ positionSeconds: 0 }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it.each([
    { mse: true, pauseBeforeMetadata: false },
    { mse: false, pauseBeforeMetadata: false },
    { mse: true, pauseBeforeMetadata: true },
    { mse: false, pauseBeforeMetadata: true },
  ])(
    'shouldPreserveLatestIntentAfterConcreteDecodeFailure($mse, $pauseBeforeMetadata)',
    async ({ mse, pauseBeforeMetadata }) => {
      serveSession()
      hls.supported = mse
      const failures: unknown[] = []
      const nextStream = {
        ...SESSION,
        id: 'sess-2',
        streamUrl: '/api/stream/decoded/multivariant.m3u8?t=next-token',
      }
      server.use(
        graphql.mutation('ReportPlaybackFormatFailure', ({ variables }) => {
          failures.push(variables)
          return HttpResponse.json({
            data: {
              reportPlaybackFormatFailure: {
                playbackSession: readyPlaybackSession({
                  id: 'playback-sess-1',
                  streamSession: nextStream,
                }),
                userErrors: [],
              },
            },
          })
        }),
      )
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await (mse ? attachedVideo() : nativeVideo())
      loadMetadata(video)
      playheadAt(video, 44.75)
      if (mse) hls.destroy.mockImplementationOnce(() => video.load())
      Object.defineProperty(video, 'error', { configurable: true, value: { code: 3 } })

      fireEvent(video, new Event('error'))
      fireEvent(video, new Event('error'))

      await waitFor(() => {
        if (mse) expect(hls.loadSource).toHaveBeenCalledWith(nextStream.streamUrl)
        if (!mse) expect(video).toHaveAttribute('src', nextStream.streamUrl)
      })
      if (pauseBeforeMetadata) {
        await user.click(screen.getByRole('button', { name: 'Play' }))
        await user.click(screen.getByRole('button', { name: 'Pause' }))
      }
      loadMetadata(video)
      expect(video.currentTime).toBe(44.75)
      expect(video.paused).toBe(pauseBeforeMetadata)
      expect(failures).toEqual([
        {
          input: {
            playbackSessionId: 'playback-sess-1',
            streamSessionId: 'sess-1',
            reason: 'DECODE_ERROR',
          },
        },
      ])
    },
  )

  it.each([true, false])(
    'shouldReconcileThePublicationGapWithoutReportingAFormatFailureOn503(%s)',
    async (fatal) => {
      serveSession()
      const failures: unknown[] = []
      let queries = 0
      const nextStream = {
        ...SESSION,
        id: 'sess-2',
        streamUrl: '/api/stream/recovered/multivariant.m3u8?t=next-token',
      }
      server.use(
        graphql.mutation('ReportPlaybackFormatFailure', ({ variables }) => {
          failures.push(variables)
          return HttpResponse.json({ errors: [{ message: 'Unexpected format failure report' }] })
        }),
        graphql.query('PlaybackSession', () => {
          queries += 1
          if (queries === 1)
            return HttpResponse.json({
              data: { playbackSession: readyPlaybackSession({ streamSession: SESSION }) },
            })
          if (queries === 2)
            return HttpResponse.json({
              data: {
                playbackSession: {
                  ...readyPlaybackSession({ streamSession: SESSION }),
                  formatAttemptCount: 2,
                  currentFormatAttempt: {
                    __typename: 'PendingPlaybackFormatAttempt',
                    streamSessionId: 'sess-2',
                  },
                },
              },
            })
          return HttpResponse.json({
            data: {
              playbackSession: {
                ...readyPlaybackSession({ id: 'playback-sess-1', streamSession: nextStream }),
                formatAttemptCount: 2,
              },
            },
          })
        }),
      )
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      loadMetadata(video)
      playheadAt(video, 61.5)
      const oldError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
      assert(oldError)

      act(() =>
        oldError('hlsError', {
          fatal,
          type: 'networkError',
          details: 'fragLoadError',
          response: { code: 503 },
        }),
      )

      await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(nextStream.streamUrl), {
        timeout: 2500,
      })
      loadMetadata(video)
      expect(video.currentTime).toBe(61.5)
      expect(queries).toBe(3)
      expect(failures).toEqual([])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it.each(['native unsupported', 'network becomes fatal', 'network remains recoverable'])(
    'shouldBoundStatusReconciliationWithoutSpendingAFormatAttempt(%s)',
    async (kind) => {
      serveSession()
      hls.supported = kind !== 'native unsupported'
      const observed = deferred()
      const failures: unknown[] = []
      server.use(
        graphql.query('PlaybackSession', () => {
          observed.resolve()
          return HttpResponse.json({
            data: { playbackSession: readyPlaybackSession({ streamSession: SESSION }) },
          })
        }),
        graphql.mutation('ReportPlaybackFormatFailure', ({ variables }) => {
          failures.push(variables)
          return HttpResponse.json({ errors: [{ message: 'Unexpected format report' }] })
        }),
      )
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await (hls.supported ? attachedVideo() : nativeVideo())
      loadMetadata(video)
      loadFirstFrame(video)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      if (kind === 'native unsupported') {
        Object.defineProperty(video, 'error', { configurable: true, value: { code: 4 } })
        fireEvent(video, new Event('error'))
      }
      const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
      if (kind !== 'native unsupported') {
        act(() =>
          onError?.('hlsError', { fatal: false, type: 'networkError', response: { code: 503 } }),
        )
      }
      await observed.promise
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      if (kind === 'network becomes fatal') {
        act(() =>
          onError?.('hlsError', { fatal: true, type: 'networkError', response: { code: 503 } }),
        )
      }

      await act(async () => vi.advanceTimersByTimeAsync(30_000))

      if (kind === 'network remains recoverable') {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(hls.destroy).not.toHaveBeenCalled()
      } else {
        expect(screen.getByRole('alert')).toHaveTextContent("Playback couldn't start.")
      }
      expect(failures).toEqual([])
    },
  )

  it('shouldDiscardAnOldStatusResponseWhenAConcreteFormatReportReplacesItsStream', async () => {
    serveSession()
    const statusStarted = deferred()
    const statusResponse = deferred()
    const nextStream = {
      ...SESSION,
      id: 'sess-2',
      streamUrl: '/api/stream/current/multivariant.m3u8?t=next-token',
    }
    server.use(
      graphql.query('PlaybackSession', async () => {
        statusStarted.resolve()
        await statusResponse.promise
        return HttpResponse.json({
          data: { playbackSession: readyPlaybackSession({ streamSession: SESSION }) },
        })
      }),
      graphql.mutation('ReportPlaybackFormatFailure', () =>
        HttpResponse.json({
          data: {
            reportPlaybackFormatFailure: {
              playbackSession: readyPlaybackSession({
                id: 'playback-sess-1',
                streamSession: nextStream,
              }),
              userErrors: [],
            },
          },
        }),
      ),
    )
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    await attachedVideo()
    const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
    assert(onError)
    act(() => onError('hlsError', { fatal: false, type: 'networkError', response: { code: 503 } }))
    await statusStarted.promise

    act(() =>
      onError('hlsError', {
        fatal: true,
        type: 'mediaError',
        details: 'bufferIncompatibleCodecsError',
      }),
    )
    await waitFor(() => expect(hls.loadSource).toHaveBeenLastCalledWith(nextStream.streamUrl))
    await act(async () => statusResponse.resolve())

    expect(hls.loadSource.mock.calls).toEqual([[STREAM_URL], [nextStream.streamUrl]])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldCloseTheLogicalSessionAndIgnorePendingStatusWhenThePlayerLeaves', async () => {
    const statusStarted = deferred()
    const statusResponse = deferred()
    const destroyed: unknown[] = []
    server.use(
      graphql.mutation('CreatePlaybackSession', () =>
        HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: {
                ...readyPlaybackSession({ streamSession: SESSION }),
                currentFormatAttempt: {
                  __typename: 'PendingPlaybackFormatAttempt',
                  streamSessionId: SESSION.id,
                },
              },
              userErrors: [],
            },
          },
        }),
      ),
      graphql.query('PlaybackSession', async () => {
        statusStarted.resolve()
        await statusResponse.promise
        return HttpResponse.json({
          data: { playbackSession: readyPlaybackSession({ streamSession: SESSION }) },
        })
      }),
      graphql.mutation('DestroyPlaybackSession', ({ variables }) => {
        destroyed.push(variables)
        return HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        })
      }),
    )
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    await act(() => statusStarted.promise)

    unmount()
    await waitFor(() =>
      expect(destroyed).toEqual([{ input: { playbackSessionId: 'playback-sess-1' } }]),
    )
    await act(async () => statusResponse.resolve())

    expect(hls.loadSource).not.toHaveBeenCalled()
    expect(destroyed).toHaveLength(1)
  })

  it.each([
    { type: 'networkError', details: 'fragLoadError' },
    { type: 'mediaError', details: 'bufferStalledError' },
    { type: 'mediaError', details: 'bufferFullError' },
    { type: 'mediaError', details: 'bufferNudgeOnStall' },
    { type: 'mediaError', details: 'mediaSourceRequiresReset' },
    { type: 'mediaError', details: 'fragParsingError' },
    {
      type: 'mediaError',
      details: 'bufferAppendError',
      error: new DOMException('Quota', 'QuotaExceededError'),
    },
    {
      type: 'mediaError',
      details: 'bufferAddCodecError',
      error: new DOMException('State', 'InvalidStateError'),
    },
  ])('shouldNotReportAFormatFailureForAnIndeterminateHlsError($details)', async (error) => {
    serveSession()
    const failures: unknown[] = []
    server.use(
      graphql.mutation('ReportPlaybackFormatFailure', ({ variables }) => {
        failures.push(variables)
        return HttpResponse.json({ errors: [{ message: 'Unexpected format report' }] })
      }),
    )
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    await attachedVideo()
    const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
    assert(onError)

    act(() => onError('hlsError', { fatal: true, ...error }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(failures).toEqual([])
  })

  it('shouldPreserveTheRequestedResumeWhenTheInitialCodecFailsBeforeMetadata', async () => {
    serveSession()
    const nextStream = {
      ...SESSION,
      id: 'sess-2',
      streamUrl: '/api/stream/resumed/multivariant.m3u8?t=next-token',
    }
    server.use(
      graphql.mutation('ReportPlaybackFormatFailure', () =>
        HttpResponse.json({
          data: {
            reportPlaybackFormatFailure: {
              playbackSession: readyPlaybackSession({
                id: 'playback-sess-1',
                streamSession: nextStream,
              }),
              userErrors: [],
            },
          },
        }),
      ),
    )
    renderWithProviders(
      <Player
        playbackPlatform={withoutDecodingInfo}
        mediaFileId="abcd"
        startPositionSeconds={143.5}
      />,
    )
    const video = await attachedVideo()
    const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
    assert(onError)

    act(() =>
      onError('hlsError', {
        fatal: true,
        type: 'mediaError',
        details: 'manifestIncompatibleCodecsError',
      }),
    )
    await waitFor(() => expect(hls.loadSource).toHaveBeenLastCalledWith(nextStream.streamUrl))
    loadMetadata(video)

    expect(video.currentTime).toBe(143.5)
    expect(video.paused).toBe(false)
  })

  it('shouldKeepQueuedTimelineReportsBoundToTheirChildDuringHandover', async () => {
    serveSession()
    const reportStarted = deferred()
    const reportResponse = deferred()
    const reports: unknown[] = []
    const nextStream = {
      ...SESSION,
      id: 'sess-2',
      streamUrl: '/api/stream/timeline/multivariant.m3u8?t=next-token',
    }
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', async ({ variables }) => {
        reports.push(variables)
        if (variables.sessionId === SESSION.id) {
          reportStarted.resolve()
          await reportResponse.promise
        }
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
      graphql.mutation('ReportPlaybackFormatFailure', () =>
        HttpResponse.json({
          data: {
            reportPlaybackFormatFailure: {
              playbackSession: readyPlaybackSession({
                id: 'playback-sess-1',
                streamSession: nextStream,
              }),
              userErrors: [],
            },
          },
        }),
      ),
    )
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    const video = await attachedVideo()
    loadMetadata(video)
    playheadAt(video, 12)
    await reportStarted.promise
    playheadAt(video, 25)
    const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
    assert(onError)

    act(() =>
      onError('hlsError', {
        fatal: true,
        type: 'mediaError',
        details: 'bufferIncompatibleCodecsError',
      }),
    )
    await waitFor(() => expect(hls.loadSource).toHaveBeenLastCalledWith(nextStream.streamUrl))
    loadMetadata(video)
    playheadAt(video, 38)
    await act(async () => reportResponse.resolve())

    await waitFor(() =>
      expect(reports).toEqual([
        { sessionId: 'sess-1', positionSeconds: 12, state: 'PLAYING' },
        { sessionId: 'sess-2', positionSeconds: 38, state: 'PLAYING' },
      ]),
    )
  })

  it.each(['closed', 'transport', 'exhausted'])(
    'shouldShowTheFailureWithoutCreatingAnotherSessionWhenAFormatReportFails(%s)',
    async (kind) => {
      serveSession()
      let reports = 0
      server.use(
        graphql.mutation('ReportPlaybackFormatFailure', () => {
          reports += 1
          if (kind === 'transport')
            return HttpResponse.json({ errors: [{ message: 'Unavailable' }] })
          if (kind === 'closed')
            return HttpResponse.json({
              data: {
                reportPlaybackFormatFailure: {
                  playbackSession: null,
                  userErrors: [
                    {
                      __typename: 'PlaybackSessionClosedError',
                      message: 'This playback session has ended.',
                    },
                  ],
                },
              },
            })
          return HttpResponse.json({
            data: {
              reportPlaybackFormatFailure: {
                playbackSession: {
                  ...readyPlaybackSession({ streamSession: SESSION }),
                  currentFormatAttempt: {
                    __typename: 'FailedPlaybackFormatAttempt',
                    streamSessionId: SESSION.id,
                    error: {
                      __typename: 'PlaybackFormatAttemptsExhaustedError',
                      message: 'No format attempts remain.',
                    },
                  },
                },
                userErrors: [],
              },
            },
          })
        }),
      )
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      await attachedVideo()
      const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
      assert(onError)

      act(() =>
        onError('hlsError', {
          fatal: true,
          type: 'mediaError',
          details: 'bufferAddCodecError',
          error: new DOMException('Unsupported', 'NotSupportedError'),
        }),
      )

      const message = {
        closed: 'This playback session has ended.',
        transport: "Playback couldn't start.",
        exhausted: 'No format attempts remain.',
      }[kind]
      expect(await screen.findByRole('alert')).toHaveTextContent(message ?? '')
      expect(reports).toBe(1)
      expect(hls.loadSource).toHaveBeenCalledOnce()
    },
  )

  it.each(['absent', 'transport'])(
    'shouldShowFailureWhenStatusCannotRecoverAFatalStream(%s)',
    async (kind) => {
      serveSession()
      server.use(
        graphql.query('PlaybackSession', () =>
          kind === 'absent'
            ? HttpResponse.json({ data: { playbackSession: null } })
            : HttpResponse.json({ errors: [{ message: 'Unavailable' }] }),
        ),
      )
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      await attachedVideo()
      const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
      assert(onError)

      act(() => onError('hlsError', { fatal: true, type: 'networkError', response: { code: 503 } }))

      expect(await screen.findByRole('alert')).toHaveTextContent("Playback couldn't start.")
      expect(hls.loadSource).toHaveBeenCalledOnce()
    },
  )

  it('shouldReleaseOwnershipWhileAFormatReportIsPendingAfterUnmount', async () => {
    serveSession()
    const reportStarted = deferred()
    const reportResponse = deferred()
    const destroyed: unknown[] = []
    server.use(
      graphql.mutation('ReportPlaybackFormatFailure', async () => {
        reportStarted.resolve()
        await reportResponse.promise
        return HttpResponse.json({
          data: {
            reportPlaybackFormatFailure: {
              playbackSession: readyPlaybackSession({ streamSession: SESSION }),
              userErrors: [],
            },
          },
        })
      }),
      graphql.mutation('DestroyPlaybackSession', ({ variables }) => {
        destroyed.push(variables)
        return HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        })
      }),
    )
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    await attachedVideo()
    const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
    assert(onError)
    act(() =>
      onError('hlsError', {
        fatal: true,
        type: 'mediaError',
        details: 'bufferIncompatibleCodecsError',
      }),
    )
    await reportStarted.promise

    unmount()
    await waitFor(() =>
      expect(destroyed).toEqual([{ input: { playbackSessionId: 'playback-sess-1' } }]),
    )
    await act(async () => reportResponse.resolve())

    expect(hls.loadSource).toHaveBeenCalledOnce()
  })

  it('shouldKeepPlaybackTokensOutOfTheApolloCacheAcrossHandover', async () => {
    serveSession()
    let readCache: (() => string) | undefined
    function ObservedPlayer() {
      const client = useApolloClient()
      useEffect(() => {
        readCache = () => JSON.stringify(client.cache.extract())
      }, [client])
      return <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />
    }
    const nextStream = {
      ...SESSION,
      id: 'sess-2',
      streamUrl: '/api/stream/secret/multivariant.m3u8?t=next-secret',
    }
    server.use(
      graphql.mutation('ReportPlaybackFormatFailure', () =>
        HttpResponse.json({
          data: {
            reportPlaybackFormatFailure: {
              playbackSession: readyPlaybackSession({
                id: 'playback-sess-1',
                streamSession: nextStream,
              }),
              userErrors: [],
            },
          },
        }),
      ),
    )
    renderWithProviders(<ObservedPlayer />)
    await attachedVideo()
    assert(readCache)
    expect(readCache()).not.toContain('playback-token')
    const onError = hls.on.mock.calls.find(([event]) => event === 'hlsError')?.[1]
    assert(onError)

    act(() =>
      onError('hlsError', {
        fatal: true,
        type: 'mediaError',
        details: 'manifestIncompatibleCodecsError',
      }),
    )
    await waitFor(() => expect(hls.loadSource).toHaveBeenLastCalledWith(nextStream.streamUrl))

    expect(readCache()).not.toContain('next-secret')
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
    expect(activeSessions).toEqual(new Set(['playback-sess-b']))
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
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
    expect(activeSessions).toEqual(new Set(['playback-sess-a']))

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
        graphql.mutation('DestroyPlaybackSession', ({ variables }) => {
          destructions += 1
          if (destructions > 1) {
            activeSessions.delete(destroyedPlaybackSession(variables).playbackSessionId)
            return HttpResponse.json({
              data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
            })
          }
          return outcome === 'unacknowledged'
            ? HttpResponse.json({
                data: { destroyPlaybackSession: { playbackSessionId: null, userErrors: [] } },
              })
            : HttpResponse.json({ errors: [{ message: 'Cleanup temporarily unavailable' }] })
        }),
      )
      const { user, unmount } = renderWithProviders(<Harness />)
      await attachedVideo('/api/stream/a/multivariant.m3u8?t=playback-token')

      await user.click(screen.getByRole('button', { name: 'Next' }))
      await screen.findByRole('alert')
      expect(attempts).toEqual(['a'])
      expect(activeSessions).toEqual(new Set(['playback-sess-a']))

      await user.click(screen.getByRole('button', { name: 'Retry playback' }))
      await waitFor(() =>
        expect(hls.loadSource).toHaveBeenLastCalledWith(
          '/api/stream/b/multivariant.m3u8?t=playback-token',
        ),
      )
      expect(destructions).toBe(2)
      expect(activeSessions).toEqual(new Set(['playback-sess-b']))
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
      graphql.mutation('DestroyPlaybackSession', async ({ variables, request }) => {
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
        activeSessions.delete(destroyedPlaybackSession(variables).playbackSessionId)
        return HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        })
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
    expect(activeSessions).toEqual(new Set(['playback-sess-a']))
    recoveryResponse.resolve()

    await waitFor(() =>
      expect(hls.loadSource).toHaveBeenLastCalledWith(
        '/api/stream/b/multivariant.m3u8?t=playback-token',
      ),
    )
    expect(activeSessions).toEqual(new Set(['playback-sess-b']))
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
    const { user, unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
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
    expect(activeSessions).toEqual(new Set(['playback-sess-abcd']))
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
    expect(activeSessions).toEqual(new Set(['playback-sess-abcd']))
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

    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    await started.promise
    await act(async () => response.resolve())

    await attachedVideo()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(activeSessions).toEqual(new Set(['playback-sess-abcd']))

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
    expect(activeSessions).toEqual(new Set(['playback-sess-b']))

    unmount()
    await waitFor(() => expect(activeSessions.size).toBe(0))
  })

  it('shouldNeverCreateASessionForAMediaFileWhenTheViewerLeftWhileTheBrowserWasStillAnswering', async () => {
    const probing = deferred()
    const answers = deferred()
    const decodingInfo = () => {
      probing.resolve()
      return answers.promise.then(() => ({ supported: true, smooth: true, powerEfficient: true }))
    }
    const creationAttempts: string[] = []
    const activeSessions = serveSingleWorkerSlot({
      onCreateAttempt: (mediaFileId) => creationAttempts.push(mediaFileId),
    })

    const { user, unmount } = renderWithProviders(
      <Harness playbackPlatform={() => playbackPlatformFixture({ decodingInfo })} />,
    )
    await probing.promise
    await user.click(screen.getByRole('button', { name: 'Next' }))
    answers.resolve()

    await waitFor(() =>
      expect(hls.loadSource).toHaveBeenCalledExactlyOnceWith(
        '/api/stream/b/multivariant.m3u8?t=playback-token',
      ),
    )
    expect(creationAttempts).toEqual(['b'])

    unmount()
    await waitFor(() => expect(activeSessions.size).toBe(0))
  })

  it('shouldStartTheNextMediaFileWithoutWaitingWhenTheLeftMediaFilesProbesGoUnanswered', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const probing = deferred()
    const leftPlatform = playbackPlatformFixture({
      decodingInfo: () => {
        probing.resolve()
        return new Promise(() => {})
      },
    })
    const platforms = [leftPlatform]
    const creationAttempts: string[] = []
    serveSingleWorkerSlot({
      onCreateAttempt: (mediaFileId) => creationAttempts.push(mediaFileId),
    })

    renderWithProviders(
      <Harness playbackPlatform={() => platforms.shift() ?? withoutDecodingInfo()} />,
    )
    await probing.promise
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // Short of the probe deadline: the left media file's probes are still unanswered.
    await act(async () => vi.advanceTimersByTimeAsync(2_999))
    vi.useRealTimers()

    await waitFor(() =>
      expect(hls.loadSource).toHaveBeenCalledExactlyOnceWith(
        '/api/stream/b/multivariant.m3u8?t=playback-token',
      ),
    )
    expect(creationAttempts).toEqual(['b'])
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
    expect(activeSessions).toEqual(new Set(['playback-sess-a']))
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
    expect(activeSessions).toEqual(new Set(['playback-sess-b']))

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
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
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
      graphql.mutation('DestroyPlaybackSession', ({ variables }) => {
        destroyed = true
        return HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        })
      }),
    )
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
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
      graphql.mutation('CreatePlaybackSession', ({ variables: v }) => {
        variables = v
        return HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: readyPlaybackSession({ streamSession: SESSION }),
              userErrors: [],
            },
          },
        })
      }),
    )

    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)

    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))
    expect(hls.attachMedia).toHaveBeenCalledOnce()
    expect(variables).toEqual({ input: { mediaFileId: 'abcd', capabilities: MINIMAL_DECLARATION } })
  })

  it('shouldDestroyASessionThatFinishesCreatingAfterThePlayerLeaves', async () => {
    const gate = deferred()
    const started = deferred()
    const destroyed: unknown[] = []
    server.use(
      graphql.mutation('CreatePlaybackSession', async () => {
        started.resolve()
        await gate.promise
        return HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: readyPlaybackSession({ streamSession: SESSION }),
              userErrors: [],
            },
          },
        })
      }),
      graphql.mutation('DestroyPlaybackSession', ({ variables }) => {
        destroyed.push(destroyedPlaybackSession(variables).playbackSessionId)
        return HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        })
      }),
    )
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    await started.promise
    unmount()
    gate.resolve()

    await waitFor(() => expect(destroyed).toEqual(['playback-sess-1']))
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
      graphql.mutation('DestroyPlaybackSession', ({ variables }) => {
        completed.push('DESTROYED')
        return HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        })
      }),
    )
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    const video = await attachedVideo()
    playheadAt(video, 5)
    unmount()
    await started.promise
    gate.resolve()

    await waitFor(() => expect(completed).toEqual(['STOPPED', 'DESTROYED']))
  })

  it('shouldShowErrorWhenSessionCreationFails', async () => {
    failSessionCreation()

    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('shouldShowTheServersRefusalWhenTheSessionIsRefused', async () => {
    refuseSession()

    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(CAPACITY_REFUSAL)
    expect(hls.loadSource).not.toHaveBeenCalled()
  })

  it.each([
    'CapabilityValuesRequiredError',
    'HlsAacCapabilityRequiredError',
    'CapabilityListTooLongError',
    'CapabilityMaximumInvalidError',
    'CapabilityProfileMismatchError',
    'VideoCodecTierInvalidError',
  ])('shouldShowThePlaybackFailureWhenTheServerRefusesTheDeclarationWith%s', async (typename) => {
    server.use(
      graphql.mutation('CreatePlaybackSession', () =>
        HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: null,
              userErrors: [{ __typename: typename, message: DECLARATION_REFUSAL }],
            },
          },
        }),
      ),
    )

    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Playback couldn't start. Try again.",
    )
    expect(screen.getByRole('alert')).not.toHaveTextContent(DECLARATION_REFUSAL)
  })

  it('shouldReportAFatalStreamErrorAndTearDownHls', async () => {
    server.use(
      graphql.mutation('CreatePlaybackSession', () =>
        HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: readyPlaybackSession({ streamSession: SESSION }),
              userErrors: [],
            },
          },
        }),
      ),
    )
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))

    raiseHlsFatalError()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(hls.destroy).toHaveBeenCalled()
  })

  it('shouldShowThePlaybackErrorWhenTheNativeElementCannotPlayTheStream', async () => {
    hls.supported = false
    serveSession()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
      graphql.mutation('CreatePlaybackSession', async () => {
        creations += 1
        if (creations > 1) {
          await retryResponse.promise
        }
        return HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: readyPlaybackSession({ streamSession: SESSION }),
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
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
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
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
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
    renderWithProviders(
      <Player
        playbackPlatform={withoutDecodingInfo}
        mediaFileId="abcd"
        startPositionSeconds={120}
      />,
    )
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
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await nativeVideo()

      reachWaitingPoint(video)
      fireEvent(video, new Event('suspend'))
      await act(async () => vi.advanceTimersByTimeAsync(60_000))

      vi.useRealTimers()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(video).toHaveAttribute('src', STREAM_URL)
      expect(activeSessions).toEqual(new Set(['playback-sess-abcd']))
    },
  )

  it.each(NATIVE_WAITING_POINTS)(
    'shouldRestartTheStartupDeadlineWhenTheViewerPlaysTheNativeElementWaiting%s',
    async (_point, reachWaitingPoint) => {
      hls.supported = false
      const activeSessions = serveSingleWorkerSlot()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    const video = await nativeVideo()
    loadMetadata(video)
    pressPlay(video)
    pressPause(video)

    fireEvent(video, new Event('suspend'))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))

    vi.useRealTimers()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(video).toHaveAttribute('src', STREAM_URL)
    expect(activeSessions).toEqual(new Set(['playback-sess-abcd']))
  })

  it('shouldNotRestartTheStartupDeadlineWhenTheViewerPlaysALoadedNativeStream', async () => {
    hls.supported = false
    serveSession()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    const video = await nativeVideo()
    refuseToStartPlayback(video)

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
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      expect(await screen.findByRole('alert')).toHaveTextContent(message)

      await act(async () => vi.advanceTimersByTimeAsync(30_000))

      vi.useRealTimers()
      expect(screen.getByRole('alert')).toHaveTextContent(message)
    },
  )

  it('shouldRecoverWhenTheNextMediaFileStartsAfterAFailedOne', async () => {
    server.use(
      graphql.mutation('CreatePlaybackSession', ({ variables }) =>
        (variables as { input: { mediaFileId: string } }).input.mediaFileId === 'a'
          ? HttpResponse.json({ errors: [{ message: 'boom' }] }, { status: 200 })
          : HttpResponse.json({
              data: {
                createPlaybackSession: {
                  playbackSession: readyPlaybackSession({ streamSession: SESSION }),
                  userErrors: [],
                },
              },
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
    renderWithProviders(
      <Player
        playbackPlatform={withoutDecodingInfo}
        mediaFileId="abcd"
        startPositionSeconds={120}
      />,
    )
    const video = await attachedVideo()

    loadMetadata(video)

    expect(video.currentTime).toBe(120)
  })

  it('shouldStartFromTheBeginningWhenNoStartPositionIsGiven', async () => {
    serveSession()
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    const video = await attachedVideo()

    loadMetadata(video)

    expect(video.currentTime).toBe(0)
  })

  it.each(STREAM_PATHS)(
    'shouldStartPlaybackOnceTheStreamLoadsOnThe%s',
    async (_path, { supported, streamingVideo }) => {
      hls.supported = supported
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await streamingVideo()

      loadMetadata(video)

      expect(video.paused).toBe(false)
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    },
  )

  it('shouldStartPlaybackOnlyOnceTheStartPositionIsApplied', async () => {
    serveSession()
    renderWithProviders(
      <Player
        playbackPlatform={withoutDecodingInfo}
        mediaFileId="abcd"
        startPositionSeconds={120}
      />,
    )
    const video = await attachedVideo()
    const startedAt: number[] = []
    video.addEventListener('play', () => startedAt.push(video.currentTime))

    loadMetadata(video)

    expect(startedAt).toEqual([120])
  })

  it('shouldWaitOnPlayWithoutAnAlertWhenTheBrowserRefusesToStartPlayback', async () => {
    serveSession()
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    const video = await attachedVideo()
    const play = refuseToStartPlayback(video)

    loadMetadata(video)
    await act(async () => {})

    expect(play.calls).toBe(1)
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(video.muted).toBe(false)
  })

  it.each(STREAM_PATHS)(
    'shouldStayPausedWhenTheViewerPausedBeforeTheStreamLoadedOnThe%s',
    async (_path, { supported, streamingVideo }) => {
      hls.supported = supported
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await streamingVideo()
      await user.click(screen.getByRole('button', { name: 'Play' }))
      await user.click(screen.getByRole('button', { name: 'Pause' }))

      loadMetadata(video)

      expect(video.paused).toBe(true)
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    },
  )

  it('shouldStartPlaybackOnceARetriedStreamLoads', async () => {
    serveSession()
    const { user } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    await attachedVideo()
    raiseHlsFatalError()
    await user.click(await screen.findByRole('button', { name: 'Retry playback' }))
    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledTimes(2))
    const video = await attachedVideo()

    loadMetadata(video)

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it.each(STREAM_PATHS)(
    'shouldNotPlayTheStreamWhenItsMetadataLoadsAfterThePlayerLeavesOnThe%s',
    async (_path, { supported, streamingVideo }) => {
      hls.supported = supported
      serveSession()
      const { unmount } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await streamingVideo()
      const play = replacePlay(video, () => Promise.resolve())
      unmount()

      loadMetadata(video)

      expect(play.calls).toBe(0)
    },
  )

  it.each(STREAM_PATHS)(
    'shouldNotPlayTheStreamWhenItsMetadataLoadsAfterItFailedOnThe%s',
    async (_path, { supported, streamingVideo, failStream }) => {
      hls.supported = supported
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await streamingVideo()
      const play = replacePlay(video, () => Promise.resolve())
      failStream(video)
      await screen.findByRole('alert')

      loadMetadata(video)

      expect(play.calls).toBe(0)
    },
  )

  it.each(STREAM_PATHS)(
    'shouldNotPlayTheStreamWhenItsMetadataLoadsAfterStartupTimedOutOnThe%s',
    async (_path, { supported, streamingVideo }) => {
      hls.supported = supported
      serveSession()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await streamingVideo()
      const play = replacePlay(video, () => Promise.resolve())
      await act(async () => vi.advanceTimersByTimeAsync(30_000))
      vi.useRealTimers()
      expect(screen.getByRole('alert')).toHaveTextContent('Playback is taking too long to start.')

      loadMetadata(video)

      expect(play.calls).toBe(0)
    },
  )

  it('shouldReportPlayingTimelineEveryTenSecondsOfPlayback', async () => {
    const reports = serveSession()
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    const video = await attachedVideo()

    video.currentTime = 7
    fireEvent(video, new Event('pause'))

    await waitFor(() =>
      expect(reports).toEqual([{ sessionId: 'sess-1', positionSeconds: 7, state: 'PAUSED' }]),
    )
  })

  it('shouldReportStoppedStateAtTheLastKnownPositionOnUnmount', async () => {
    const reports = serveSession()
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    const video = await attachedVideo()
    playheadAt(video, 42)
    await waitFor(() => expect(reports).toHaveLength(1))

    unmount()

    await waitFor(() => expect(reports).toHaveLength(2))
    expect(reports[1]).toEqual({ sessionId: 'sess-1', positionSeconds: 42, state: 'STOPPED' })
  })

  it('shouldReportStoppedOnceAtTheFinalPositionWhenPlaybackReachesTheEnd', async () => {
    const reports = serveSession()
    let destroyed = false
    server.use(
      graphql.mutation('DestroyPlaybackSession', ({ variables }) => {
        destroyed = true
        return HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        })
      }),
    )
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    const video = await attachedVideo()

    playedToTheEnd(video, 5400)

    await waitFor(() =>
      expect(reports.at(-1)).toEqual({
        sessionId: 'sess-1',
        positionSeconds: 5400,
        state: 'STOPPED',
      }),
    )
    unmount()
    await waitFor(() => expect(destroyed).toBe(true))
    expect(reports.filter((report) => report.state === 'STOPPED')).toHaveLength(1)
  })

  it('shouldReportStoppedAgainOnLeavingWhenTheEndOfPlaybackReportFailed', async () => {
    const reports = serveSession()
    const stopRefused = refuseTheFirstStoppedReport(reports)
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    const video = await attachedVideo()
    playedToTheEnd(video, 5400)
    await waitFor(() => expect(stopRefused()).toBe(true))

    unmount()

    await waitFor(() =>
      expect(reports.filter((report) => report.state === 'STOPPED')).toEqual([
        { sessionId: 'sess-1', positionSeconds: 5400, state: 'STOPPED' },
        { sessionId: 'sess-1', positionSeconds: 5400, state: 'STOPPED' },
      ]),
    )
  })

  it('shouldReportStoppedAtTheFinalPositionOnLeavingWhenTheEndOfPlaybackReportFailedBeforeAReplay', async () => {
    const reports = serveSession()
    const stopRefused = refuseTheFirstStoppedReport(reports)
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    const video = await attachedVideo()
    playedToTheEnd(video, 5400)
    await waitFor(() => expect(stopRefused()).toBe(true))

    playheadAt(video, 30)
    unmount()

    await waitFor(() =>
      expect(reports.filter((report) => report.state === 'STOPPED')).toEqual([
        { sessionId: 'sess-1', positionSeconds: 5400, state: 'STOPPED' },
        { sessionId: 'sess-1', positionSeconds: 5400, state: 'STOPPED' },
        { sessionId: 'sess-1', positionSeconds: 30, state: 'STOPPED' },
      ]),
    )
  })

  it('shouldReportStoppedOnceWhenTheViewerLeavesBeforeTheEndOfPlaybackReportIsAcknowledged', async () => {
    const reports = serveSession()
    const acknowledgement = deferred()
    let destroyed = false
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', async ({ variables }) => {
        reports.push(variables as unknown as TimelineReport)
        if (variables.state === 'STOPPED') await acknowledgement.promise
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
      graphql.mutation('DestroyPlaybackSession', ({ variables }) => {
        destroyed = true
        return HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        })
      }),
    )
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    const video = await attachedVideo()
    playedToTheEnd(video, 5400)
    await waitFor(() => expect(reports.at(-1)?.state).toBe('STOPPED'))

    unmount()
    acknowledgement.resolve()

    await waitFor(() => expect(destroyed).toBe(true))
    expect(reports.filter((report) => report.state === 'STOPPED')).toHaveLength(1)
  })

  it('shouldReportStoppedAtTheReplayPositionWhenTheEndOfPlaybackReportIsAcknowledgedLate', async () => {
    const reports = serveSession()
    const acknowledgement = deferred()
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', async ({ variables }) => {
        reports.push(variables as unknown as TimelineReport)
        if (variables.state === 'STOPPED' && variables.positionSeconds === 5400) {
          await acknowledgement.promise
        }
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
    )
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    const video = await attachedVideo()
    playedToTheEnd(video, 5400)
    await waitFor(() => expect(reports.at(-1)?.state).toBe('STOPPED'))

    playheadAt(video, 30)
    unmount()
    acknowledgement.resolve()

    await waitFor(() =>
      expect(reports.at(-1)).toEqual({
        sessionId: 'sess-1',
        positionSeconds: 30,
        state: 'STOPPED',
      }),
    )
  })

  it('shouldReportStoppedAtTheFinalPositionWhenTheViewerReplaysBeforeTheEndOfPlaybackReportIsSent', async () => {
    const reports = serveSession()
    const pauseAcknowledgement = deferred()
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', async ({ variables }) => {
        reports.push(variables as unknown as TimelineReport)
        if (variables.state === 'PAUSED') await pauseAcknowledgement.promise
        return HttpResponse.json({ data: { reportStreamSessionTimeline: true } })
      }),
    )
    renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
    const video = await attachedVideo()
    playedToTheEnd(video, 5400)
    await waitFor(() => expect(reports.at(-1)?.state).toBe('PAUSED'))

    playheadAt(video, 30)
    pauseAcknowledgement.resolve()

    await waitFor(() =>
      expect(reports.filter((report) => report.state === 'STOPPED')).toEqual([
        { sessionId: 'sess-1', positionSeconds: 5400, state: 'STOPPED' },
      ]),
    )
  })

  it('shouldReportStoppedAtTheLastKnownPositionWhenTheViewerReplaysAfterTheEndAndLeaves', async () => {
    const reports = serveSession()
    const { unmount } = renderWithProviders(
      <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
    )
    const video = await attachedVideo()
    playedToTheEnd(video, 5400)
    await waitFor(() => expect(reports.at(-1)?.state).toBe('STOPPED'))

    playheadAt(video, 30)
    unmount()

    await waitFor(() =>
      expect(reports.at(-1)).toEqual({
        sessionId: 'sess-1',
        positionSeconds: 30,
        state: 'STOPPED',
      }),
    )
  })

  describe('controls', () => {
    afterEach(() => {
      for (const property of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) {
        Reflect.deleteProperty(document, property)
      }
    })

    it('shouldHandPlaybackToTheControlBarInsteadOfTheBrowserControls', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()

      const video = await attachedVideo()

      expect(video).not.toHaveAttribute('controls')
      expect(video).toHaveAttribute('playsinline')
      expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled()
    })

    it('shouldPlayAndPauseFromTheRoundButton', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await attachedVideo()

      await user.click(screen.getByRole('button', { name: 'Play' }))
      expect(video.paused).toBe(false)

      await user.click(screen.getByRole('button', { name: 'Pause' }))
      expect(video.paused).toBe(true)
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    })

    it('shouldPlayAndPauseWithSpace', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await attachedVideo()

      await user.keyboard(' ')
      expect(video.paused).toBe(false)
      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()

      await user.keyboard(' ')
      expect(video.paused).toBe(true)
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    })

    it('shouldPlayOnceWhileSpaceIsHeldDown', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await attachedVideo()

      await user.keyboard('[Space>2/]')

      expect(video.paused).toBe(false)
    })

    it.each(['Control', 'Alt', 'Meta'])(
      'shouldNeitherPlayNorPauseWhenSpaceIsPressedWith%s',
      async (modifier) => {
        serveSession()
        const { user } = renderWithProviders(
          <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
        )
        const video = await attachedVideo()

        await user.keyboard(`{${modifier}>}[Space]{/${modifier}}`)

        expect(video.paused).toBe(true)
      },
    )

    it('shouldNeitherPlayNorPauseWithSpaceWhilePlayIsDisabled', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await attachedVideo()
      raiseHlsFatalError()
      expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()

      await user.keyboard(' ')

      expect(video.paused).toBe(true)
    })

    it('shouldLeaveAClickedMuteAsItIsWhenSpaceIsPressedBeforeTheStreamAttaches', async () => {
      const creationResponse = deferred()
      serveSingleWorkerSlot({ beforeCreated: () => creationResponse.promise })
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await user.click(screen.getByRole('button', { name: 'Mute' }))
      const unmute = screen.getByRole('button', { name: 'Unmute' })
      expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()

      await user.keyboard(' ')

      expect(unmute).toHaveAccessibleName('Unmute')
      creationResponse.resolve()
      const video = await attachedVideo()
      expect(video.muted).toBe(true)
    })

    it('shouldPauseWithSpaceAndSkipNoFurtherAfterAClickOnForward', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await seekableVideo(2824)
      await act(() => video.play())
      await user.click(screen.getByRole('button', { name: 'Forward 10 seconds' }))
      expect(video.currentTime).toBe(10)

      await user.keyboard(' ')

      expect(video.paused).toBe(true)
      expect(video.currentTime).toBe(10)
    })

    it('shouldPauseAndShowTheFadedControlsOnSpace', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await attachedVideo()
      const player = screen.getByRole('region', { name: 'Player' })
      await playUntilFaded(video)
      expect(player).toHaveAttribute('data-idle')
      vi.useRealTimers()

      await user.keyboard(' ')

      expect(video.paused).toBe(true)
      expect(player).not.toHaveAttribute('data-idle')
    })

    it('shouldHoldSeekingUntilTheDurationIsKnown', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
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
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
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
      layOutSeekTrack()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
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

    it('shouldKeepPlayingWhenAPressOnTheSeekSliderMissesItsTrack', async () => {
      const reports = serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await seekableVideo(2824)
      await user.click(screen.getByRole('button', { name: 'Play' }))
      const seekRoot = screen.getByRole('slider', { name: 'Seek' }).closest('.mantine-Slider-root')
      assert(seekRoot)

      await user.pointer({ keys: '[MouseLeft]', target: seekRoot })
      playheadAt(video, 1200)

      expect(video.paused).toBe(false)
      expect(screen.getByText('20:00 / 47:04')).toBeInTheDocument()
      expect(reports.filter((report) => report.state === 'PAUSED')).toEqual([])
    })

    it('shouldResumePlaybackWhereItWasWhenATouchScrubIsCancelled', async () => {
      const reports = serveSession()
      layOutSeekTrack()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await seekableVideo(2000)
      await act(() => video.play())
      playheadAt(video, 30)
      const seek = screen.getByRole('slider', { name: 'Seek' })
      touchDown(seek, 250)
      await nextAnimationFrame()
      expect(screen.getByText('8:20 / 33:20')).toBeInTheDocument()

      cancelTouch(seek)

      expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
      expect(video.currentTime).toBe(30)
      playheadAt(video, 45)
      expect(screen.getByText('0:45 / 33:20')).toBeInTheDocument()
      await waitFor(() =>
        expect(reports).toEqual([
          { sessionId: 'sess-1', positionSeconds: 30, state: 'PLAYING' },
          { sessionId: 'sess-1', positionSeconds: 30, state: 'PAUSED' },
          { sessionId: 'sess-1', positionSeconds: 45, state: 'PLAYING' },
        ]),
      )
    })

    it('shouldSeekOnlyWhereTheViewerNextAsksWhenATouchScrubWasCancelled', async () => {
      serveSession()
      layOutSeekTrack()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await seekableVideo(2000)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await act(() => video.play())
      playheadAt(video, 30)
      const seek = screen.getByRole('slider', { name: 'Seek' })
      touchDown(seek, 250)
      await nextAnimationFrame()
      expect(screen.getByText('8:20 / 33:20')).toBeInTheDocument()
      cancelTouch(seek)

      const forward = screen.getByRole('button', { name: 'Forward 10 seconds' })
      touchDown(forward)
      liftTouch(forward)
      fireEvent.click(forward)
      await act(async () => vi.advanceTimersByTimeAsync(0))
      expect(video.currentTime).toBe(40)

      touchDown(seek, 500)
      await nextAnimationFrame()
      expect(screen.getByText('16:40 / 33:20')).toBeInTheDocument()
      liftTouch(seek)
      await act(async () => vi.advanceTimersByTimeAsync(0))
      expect(video.currentTime).toBe(1000)
      expect(video.paused).toBe(false)
    })

    it('shouldLeaveAReleasedStreamStoppedWhenATouchScrubIsCancelled', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await seekableVideo(2000)
      await act(() => video.play())
      const seek = screen.getByRole('slider', { name: 'Seek' })
      touchDown(seek)
      raiseHlsFatalError()

      cancelTouch(seek)

      expect(video.paused).toBe(true)
      expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    })

    it('shouldLeaveAReleasedStreamStoppedWhenTheScrubEndsAfterTheStreamFails', async () => {
      serveSession()
      layOutSeekTrack()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await seekableVideo(2000)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await act(() => video.play())
      const seek = screen.getByRole('slider', { name: 'Seek' })
      touchDown(seek, 250)
      await nextAnimationFrame()
      raiseHlsFatalError()

      liftTouch(seek)
      await act(async () => vi.advanceTimersByTimeAsync(0))

      expect(video.paused).toBe(true)
      expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
      expect(screen.queryByRole('progressbar', { name: 'Buffering' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry playback' })).toBeInTheDocument()
    })

    it('shouldMuteAndSetTheVolume', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
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
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
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
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
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

    it('shouldShowTheStreamsOnlyAudioTrackAndSubtitlesOffOnChipsThatOpenNothing', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()

      offerHlsTracks({ audio: [{ name: 'Audio' }], audioTrack: 0 })

      const audio = screen.getByRole('button', { name: 'Audio: Audio' })
      const subtitles = screen.getByRole('button', { name: 'Subtitles: Off' })
      expect(audio).toHaveTextContent(/^Audio$/)
      expect(subtitles).toHaveTextContent(/^Off$/)
      for (const chip of [audio, subtitles]) {
        expect(chip).toHaveAttribute('aria-disabled', 'true')
        await user.click(chip)
      }
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('shouldShowTheSubtitlesInUseOnTheSubtitlesChip', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      await attachedVideo()

      offerHlsTracks({
        subtitles: [{ name: 'English' }, { name: 'English (SDH)' }],
        subtitleTrack: 1,
      })

      expect(screen.getByRole('button', { name: 'Subtitles: English (SDH)' })).toHaveTextContent(
        /^English \(SDH\)$/,
      )
    })

    it('shouldHoldTheTrackChipsPlacesBeforeTheStreamNamesItsTracks', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)

      expect(screen.getByRole('button', { name: 'Audio' })).toHaveTextContent(/^$/)
      expect(screen.getByRole('button', { name: 'Subtitles: Off' })).toBeInTheDocument()
      await attachedVideo()
      expect(screen.getByRole('button', { name: 'Audio' })).toHaveTextContent(/^$/)
    })

    it('shouldForgetTheStreamsTracksOnceAFailureReleasesIt', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      await attachedVideo()
      offerHlsTracks({
        audio: [{ name: 'English' }],
        audioTrack: 0,
        subtitles: [{ name: 'English' }],
        subtitleTrack: 0,
      })

      raiseHlsFatalError()

      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Subtitles: Off' })).toBeInTheDocument()
    })

    it('shouldShowTheElementsOwnTracksOnTheNativePath', async () => {
      hls.supported = false
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const english: FakeTextTrack = {
        kind: 'subtitles',
        label: 'English',
        language: 'en',
        mode: 'disabled',
      }
      giveElementTracks(renderedVideo(), {
        audio: [
          { label: '', language: 'fr', enabled: true },
          { label: 'Commentary', language: 'en', enabled: false },
        ],
        text: [english],
      })
      await nativeVideo()

      expect(screen.getByRole('button', { name: 'Audio: French' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Subtitles: Off' })).toBeInTheDocument()

      act(() => {
        english.mode = 'showing'
      })

      expect(screen.getByRole('button', { name: 'Subtitles: English' })).toBeInTheDocument()
    })

    it('shouldSwitchSubtitlesFromThePicker', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()
      offerHlsTracks({ subtitles: [{ name: 'English' }, { name: 'English (SDH)' }] })
      const chip = screen.getByRole('button', { name: 'Subtitles: Off' })
      expect(within(chip).queryByTestId('active-track')).not.toBeInTheDocument()

      const menu = await openPicker(user, chip)

      expect(chip).toHaveAttribute('aria-expanded', 'true')
      expect(menu).toHaveAccessibleName('Subtitles')
      expect(
        within(menu)
          .getAllByRole('menuitemradio')
          .map((row) => row.textContent),
      ).toEqual(['Off', 'English', 'English (SDH)'])
      expect(within(menu).getByRole('menuitemradio', { checked: true })).toHaveTextContent('Off')

      await user.click(within(menu).getByRole('menuitemradio', { name: 'English (SDH)' }))

      expect(hls.subtitleTrack).toBe(1)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      const switched = screen.getByRole('button', { name: 'Subtitles: English (SDH)' })
      expect(switched).toHaveFocus()
      expect(within(switched).getByTestId('active-track')).toBeInTheDocument()
    })

    it('shouldMoveThroughTheAudioPickerByKeyboardAndChooseWithEnter', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()
      offerHlsTracks({
        audio: [{ name: 'English' }, { name: 'Français' }, { name: 'Commentary' }],
        audioTrack: 0,
      })
      act(() => screen.getByRole('button', { name: 'Audio: English' }).focus())

      await user.keyboard('{Enter}')
      expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveFocus()
      for (const [key, row] of [
        ['{ArrowUp}', 'Commentary'],
        ['{ArrowDown}', 'English'],
        ['{End}', 'Commentary'],
        ['{Home}', 'English'],
        ['{ArrowDown}', 'Français'],
      ]) {
        await user.keyboard(key)
        expect(screen.getByRole('menuitemradio', { name: row })).toHaveFocus()
      }
      await user.keyboard('{Enter}')

      expect(hls.audioTrack).toBe(1)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Audio: Français' })).toHaveFocus()
    })

    it('shouldStartThePickersFocusOnTheTrackInUse', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()
      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 1 })

      await openPicker(user, screen.getByRole('button', { name: 'Audio: Français' }))

      expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveFocus()
    })

    it('shouldMoveFocusToTheTrackInUseWhenTheFocusedTrackGoes', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()
      offerHlsTracks({
        audio: [{ name: 'English' }, { name: 'Français' }, { name: 'Commentary' }],
        audioTrack: 0,
      })
      act(() => screen.getByRole('button', { name: 'Audio: English' }).focus())
      await user.keyboard('{Enter}{End}')

      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 0 })

      expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveFocus()
      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(hls.audioTrack).toBe(1)
      expect(screen.getByRole('button', { name: 'Audio: Français' })).toHaveFocus()
    })

    it('shouldMoveFocusToTheNearestTrackWhenTheFocusedTrackGoesAndNoneIsInUse', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()
      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }, { name: 'Commentary' }] })
      act(() => screen.getByRole('button', { name: 'Audio' }).focus())
      await user.keyboard('{Enter}{End}')

      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }] })

      expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveFocus()
    })

    it('shouldKeepFocusOnTheFocusedTrackWhenAnotherTrackGoes', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()
      offerHlsTracks({
        audio: [{ name: 'English' }, { name: 'Français' }, { name: 'Commentary' }],
        audioTrack: 0,
      })
      act(() => screen.getByRole('button', { name: 'Audio: English' }).focus())
      await user.keyboard('{Enter}{ArrowDown}')

      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 0 })

      expect(screen.getByRole('menuitemradio', { name: 'Français' })).toHaveFocus()
    })

    it('shouldCloseThePickerWithoutChoosingOnEscapeAnOutsidePressOrItsChip', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await attachedVideo()
      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 0 })
      const chip = screen.getByRole('button', { name: 'Audio: English' })

      await openPicker(user, chip)
      await user.keyboard('{ArrowDown}{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(chip).toHaveFocus()

      await openPicker(user, chip)
      await user.click(video)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()

      await openPicker(user, chip)
      await user.click(chip)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(chip).toHaveAttribute('aria-expanded', 'false')
      expect(hls.audioTrack).toBe(0)
    })

    it('shouldCloseThePickerWhenTabMovesFocusOn', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()
      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 0 })
      await openPicker(user, screen.getByRole('button', { name: 'Audio: English' }))

      await user.tab()

      expect(screen.getByRole('button', { name: 'Subtitles: Off' })).toHaveFocus()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('shouldCloseThePickerWhenShiftTabReturnsFocusToItsChip', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()
      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 0 })
      const chip = screen.getByRole('button', { name: 'Audio: English' })
      await openPicker(user, chip)

      await user.tab({ shift: true })

      expect(chip).toHaveFocus()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(chip).toHaveAttribute('aria-expanded', 'false')
    })

    it('shouldSwitchTheElementsOwnTracksFromThePickersOnTheNativePath', async () => {
      hls.supported = false
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const audio: FakeAudioTrack[] = [
        { label: 'English', language: 'en', enabled: true },
        { label: 'Commentary', language: 'en', enabled: false },
      ]
      const text: FakeTextTrack[] = [
        { kind: 'subtitles', label: 'English', language: 'en', mode: 'disabled' },
      ]
      giveElementTracks(renderedVideo(), { audio, text })
      await nativeVideo()

      await user.click(screen.getByRole('button', { name: 'Audio: English' }))
      await user.click(screen.getByRole('menuitemradio', { name: 'Commentary' }))
      await user.click(screen.getByRole('button', { name: 'Subtitles: Off' }))
      await user.click(screen.getByRole('menuitemradio', { name: 'English' }))

      expect(audio.map((track) => track.enabled)).toEqual([false, true])
      expect(text.map((track) => track.mode)).toEqual(['showing'])
      expect(screen.getByRole('button', { name: 'Audio: Commentary' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Subtitles: English' })).toBeInTheDocument()
    })

    it('shouldCloseAnOpenPickerWhenPlaybackFailsAndKeepItClosedAfterRetry', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()
      const tracks = { audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 0 }
      offerHlsTracks(tracks)
      await openPicker(user, screen.getByRole('button', { name: 'Audio: English' }))

      raiseHlsFatalError()

      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Retry playback' }))
      await waitFor(() => expect(hls.loadSource).toHaveBeenCalledTimes(2))
      offerHlsTracks(tracks)

      expect(screen.getByRole('button', { name: 'Audio: English' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('shouldKeepAPickerClosedOnceItsChoicesGoAndReturn', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      await attachedVideo()
      const choices = { audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 0 }
      offerHlsTracks(choices)
      await openPicker(user, screen.getByRole('button', { name: 'Audio: English' }))

      offerHlsTracks({ audio: [{ name: 'English' }], audioTrack: 0 })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      offerHlsTracks(choices)

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Audio: English' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })

    it('shouldEnterAndLeaveFullScreenOnThePlayer', async () => {
      serveSession()
      const exitFullscreen = vi.fn(() => Promise.resolve())
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: exitFullscreen,
      })
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
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
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      await attachedVideo()

      expect(screen.getByRole('region', { name: 'Player' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Full screen' })).not.toBeInTheDocument()
    })

    it('shouldFadeTheControlsAfterThreeSecondsOfPlaybackUntilThePointerOrKeyboardWakesThem', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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

    it.each(['Mute', 'Back'])(
      'shouldWakeTheFadedControlsWhenFocusLandsOn%sWithoutAKeyPress',
      async (control) => {
        serveSession()
        renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
        const video = await attachedVideo()
        const player = screen.getByRole('region', { name: 'Player' })
        await playUntilFaded(video)
        expect(player).toHaveAttribute('data-idle')

        act(() => screen.getByRole('button', { name: control }).focus())

        expect(player).not.toHaveAttribute('data-idle')
      },
    )

    it('shouldFadeTheControlsAgainThreeSecondsAfterFocusLandsWhileFocusStaysOnThem', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      const player = screen.getByRole('region', { name: 'Player' })
      await playUntilFaded(video)
      const mute = screen.getByRole('button', { name: 'Mute' })

      act(() => mute.focus())
      await act(async () => vi.advanceTimersByTimeAsync(2_999))
      expect(player).not.toHaveAttribute('data-idle')
      await act(async () => vi.advanceTimersByTimeAsync(1))

      expect(player).toHaveAttribute('data-idle')
      expect(mute).toHaveFocus()
    })

    it('shouldRestartTheFadeWhenFocusMovesBetweenTheShownControls', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      const player = screen.getByRole('region', { name: 'Player' })
      await playUntilFaded(video)
      act(() => screen.getByRole('button', { name: 'Mute' }).focus())
      await act(async () => vi.advanceTimersByTimeAsync(2_000))

      act(() => screen.getByRole('button', { name: 'Back' }).focus())
      await act(async () => vi.advanceTimersByTimeAsync(2_999))
      expect(player).not.toHaveAttribute('data-idle')
      await act(async () => vi.advanceTimersByTimeAsync(1))

      expect(player).toHaveAttribute('data-idle')
    })

    it('shouldLeaveTheControlsFadedWhenFocusLandsOutsideThem', async () => {
      serveSession()
      renderWithProviders(
        <>
          <button type="button">Elsewhere</button>
          <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />
        </>,
      )
      const video = await attachedVideo()
      await playUntilFaded(video)

      act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus())

      expect(screen.getByRole('region', { name: 'Player' })).toHaveAttribute('data-idle')
    })

    it('shouldKeepTheControlsWhilePausedOrWhileTheMouseRestsOnTheBar', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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

    it('shouldKeepTheControlsWhileTheMouseRestsOnBack', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      moveMouse(screen.getByRole('button', { name: 'Back' }), video)
      await act(() => video.play())

      await act(async () => vi.advanceTimersByTimeAsync(10_000))

      expect(screen.getByRole('region', { name: 'Player' })).not.toHaveAttribute('data-idle')
    })

    it('shouldKeepTheControlsWhileAPickerIsOpen', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await attachedVideo()
      const player = screen.getByRole('region', { name: 'Player' })
      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 0 })
      const menu = await openPicker(user, screen.getByRole('button', { name: 'Audio: English' }))
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      moveMouse(video, menu)
      await act(() => video.play())

      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      expect(player).not.toHaveAttribute('data-idle')

      fireEvent.keyDown(document, { key: 'Escape' })
      await act(async () => vi.advanceTimersByTimeAsync(3_000))
      expect(player).toHaveAttribute('data-idle')
    })

    it('shouldFadeTheControlsOnceTheOpenPickersChoicesAreGone', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await attachedVideo()
      const player = screen.getByRole('region', { name: 'Player' })
      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 0 })
      const menu = await openPicker(user, screen.getByRole('button', { name: 'Audio: English' }))
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      moveMouse(video, menu)
      await act(() => video.play())

      offerHlsTracks({ audio: [{ name: 'English' }], audioTrack: 0 })
      await act(async () => vi.advanceTimersByTimeAsync(3_000))

      expect(player).toHaveAttribute('data-idle')
    })

    it('shouldLetTheTapThatWakesTheFadedControlsPressNothing', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      await playUntilFaded(video)
      const pause = screen.getByRole('button', { name: 'Pause' })

      tap(pause)
      expect(video.paused).toBe(false)
      expect(screen.getByRole('region', { name: 'Player' })).not.toHaveAttribute('data-idle')

      tap(pause)
      expect(video.paused).toBe(true)
    })

    it('shouldLetTheTapThatWakesTheFadedControlsMoveNoSlider', async () => {
      serveSession()
      layOutSeekTrack()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await seekableVideo(2000)
      await playUntilFaded(video)
      const seekTrack = screen
        .getByRole('slider', { name: 'Seek' })
        .closest('.mantine-Slider-trackContainer')
      assert(seekTrack)

      tap(video, { mouseTarget: seekTrack, clientX: 750 })
      await nextAnimationFrame()
      await act(async () => vi.advanceTimersByTimeAsync(0))

      expect(video.currentTime).toBe(0)
    })

    it('shouldPressOnTheNextTapWhenTheTouchThatWokeTheControlsMadeNoClick', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      await playUntilFaded(video)
      const pause = screen.getByRole('button', { name: 'Pause' })

      fireEvent.pointerDown(pause, { pointerType: 'touch' })
      fireEvent.pointerCancel(pause, { pointerType: 'touch' })
      tap(pause)

      expect(video.paused).toBe(true)
    })

    it('shouldPlayOnATapWhenTheControlsHaveBeenHeldPastThreeSeconds', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await act(() => video.play())
      act(() => video.pause())

      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      tap(screen.getByRole('button', { name: 'Play' }))

      expect(video.paused).toBe(false)
    })

    it('shouldChooseATrackOnATapWhenAPickerHasHeldTheControlsPastThreeSeconds', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      offerHlsTracks({ audio: [{ name: 'English' }, { name: 'Français' }], audioTrack: 0 })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      tap(screen.getByRole('button', { name: 'Audio: English' }))
      await act(() => video.play())

      await act(async () => vi.advanceTimersByTimeAsync(10_000))
      tap(screen.getByRole('menuitemradio', { name: 'Français' }))

      expect(hls.audioTrack).toBe(1)
    })

    it('shouldFadeTheControlsWhileATouchRestsOnTheBar', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await act(() => video.play())

      fireEvent.pointerMove(screen.getByRole('button', { name: 'Pause' }), { pointerType: 'touch' })
      await act(async () => vi.advanceTimersByTimeAsync(3_000))

      expect(screen.getByRole('region', { name: 'Player' })).toHaveAttribute('data-idle')
    })

    it('shouldFadeTheControlsOnceTheMouseLeavesTheBarAfterTheGlyphUnderItWasReplaced', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
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

    it('shouldShowTheVideoStoppedOnceAFailureReleasesTheStream', async () => {
      hls.supported = false
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await nativeVideo()
      await act(() => video.play())
      fireEvent(video, new Event('waiting'))
      expect(screen.getByRole('progressbar', { name: 'Buffering' })).toBeInTheDocument()

      fireEvent(video, new Event('error'))

      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(screen.queryByRole('progressbar', { name: 'Buffering' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    })

    it('shouldShowTheSkippedToPositionAsSoonAsTheSeekStarts', async () => {
      serveSession()
      const { user } = renderWithProviders(
        <Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />,
      )
      const video = await seekableVideo(2824)

      await user.click(screen.getByRole('button', { name: 'Forward 10 seconds' }))
      fireEvent(video, new Event('seeking'))

      expect(screen.getByText('0:10 / 47:04')).toBeInTheDocument()
    })

    it('shouldShowTheTimecodeAndTitleInTheTitleLine', async () => {
      serveSession()
      renderWithProviders(
        <Player
          playbackPlatform={withoutDecodingInfo}
          mediaFileId="abcd"
          title={{ heading: 'Northern Line', detail: 'S2 E5 — Breakage' }}
        />,
      )
      const video = await seekableVideo(2824)

      playheadAt(video, 1392)

      expect(screen.getByRole('heading', { level: 1, name: 'Northern Line' })).toBeInTheDocument()
      expect(screen.getByText(wholeText('S2 E5 — Breakage · 23:12 / 47:04'))).toBeInTheDocument()
    })

    it('shouldShowTheTimecodeAloneOnceTheDurationIsKnownWithoutATitle', async () => {
      serveSession()
      renderWithProviders(<Player playbackPlatform={withoutDecodingInfo} mediaFileId="abcd" />)
      const video = await attachedVideo()
      expect(screen.queryByText(/ \/ /)).not.toBeInTheDocument()

      loadDuration(video, 2824)

      expect(screen.getByText('0:00 / 47:04')).toBeInTheDocument()
    })
  })
})
