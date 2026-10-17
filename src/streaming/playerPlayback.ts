import type { ApolloClient, ObservableQuery } from '@apollo/client'
import Hls, { type ErrorData } from 'hls.js'
import {
  type CreatePlaybackSessionMutation,
  DestroyPlaybackSessionDocument,
  PlaybackSessionDocument,
  type PlaybackSessionFieldsFragment,
  type PlaybackFormatFailure,
  ReportPlaybackFormatFailureDocument,
  ReportStreamSessionTimelineDocument,
  type ReportStreamSessionTimelineMutationVariables,
} from '../graphql/generated/graphql'
import { userErrorMessage } from '../graphql/userErrors'
import { discardWatchedState } from '../media/watchedState'
import { hlsTrackSource, nativeTrackSource, type TrackSource } from './trackSources'

// Progress is only worth a round trip once the playhead has moved this far since the last report.
const TIMELINE_REPORT_INTERVAL_SECONDS = 10
const TIMELINE_CLEANUP_TIMEOUT_MS = 10_000
const PLAYBACK_START_TIMEOUT_MS = 30_000
const PLAYBACK_STATUS_INTERVAL_MS = 500

const PLAYBACK_FAILURE_MESSAGE = "Playback couldn't start. Try again."

type PlaybackState = ReportStreamSessionTimelineMutationVariables['state']
type PlaybackSessionPayload = CreatePlaybackSessionMutation['createPlaybackSession']

export type SourcePhase =
  { at: 'starting' } | { at: 'attached'; tracks: TrackSource } | { at: 'failed'; message: string }

const pendingCleanups = new WeakMap<ApolloClient, () => Promise<void>>()

export function startPlayerPlayback({
  video,
  client,
  createPlaybackSession,
  startPositionSeconds,
  onSourcePhase,
}: {
  video: HTMLVideoElement
  client: ApolloClient
  createPlaybackSession: () => Promise<{ data?: CreatePlaybackSessionMutation | null }>
  startPositionSeconds?: number
  onSourcePhase: (phase: SourcePhase) => void
}): () => void {
  let source: StreamSource | null = null
  let cancelled = false
  let sessionId: string | null = null
  let playbackSessionId: string | null = null
  let sourceGeneration = 0
  let reportingFormat = false
  let statusCheck: { controller: AbortController; generation: number; fatal: boolean } | undefined
  let resume: { position: number; playing: boolean } | undefined
  let lastReportedPosition = startPositionSeconds ?? 0
  let lastKnownPosition: number | null = null
  let unacknowledgedEndPosition: number | null = null
  let timelineReports = Promise.resolve()
  const reportCancellation = new AbortController()
  const statusCancellation = new AbortController()
  let previousCleanup = pendingCleanups.get(client)
  let cleanupInFlight: Promise<void> | undefined

  async function destroySession(id: string) {
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), PLAYBACK_START_TIMEOUT_MS)
    const result = await client
      .mutate({
        mutation: DestroyPlaybackSessionDocument,
        variables: { input: { playbackSessionId: id } },
        context: { fetchOptions: { signal: controller.signal } },
      })
      .finally(() => clearTimeout(deadline))
    const payload = result.data?.destroyPlaybackSession
    if (payload?.playbackSessionId !== id || payload.userErrors.length > 0) {
      throw new Error('Playback session destruction was not acknowledged')
    }
  }

  function report(state: PlaybackState, positionSeconds: number) {
    enqueueReport((id) =>
      sendReport({ sessionId: id, positionSeconds: Math.floor(positionSeconds), state }),
    )
  }

  // Reads the position only when its turn in the queue comes. An acknowledged STOPPED clears each
  // position it sent, so leaving repeats only a failed STOPPED, even after a replay.
  function reportStopped(readStoppedAt: () => number | null) {
    enqueueReport(async (id) => {
      const stoppedAt = readStoppedAt()
      if (stoppedAt === null) {
        return
      }
      await sendReport({
        sessionId: id,
        positionSeconds: Math.floor(stoppedAt),
        state: 'STOPPED',
      })
      if (unacknowledgedEndPosition === stoppedAt) {
        unacknowledgedEndPosition = null
      }
      if (lastKnownPosition === stoppedAt) {
        lastKnownPosition = null
      }
    })
  }

  function enqueueReport(send: (sessionId: string) => Promise<void>) {
    if (!sessionId) {
      return
    }
    const id = sessionId
    // The server accepts arrival order, including reports that precede the final STOPPED.
    timelineReports = timelineReports
      .then(async () => {
        if (reportCancellation.signal.aborted || id !== sessionId) {
          return
        }
        await send(id)
      })
      .catch(ignoreTimelineReportFailure)
  }

  async function sendReport(variables: ReportStreamSessionTimelineMutationVariables) {
    await client.mutate({
      mutation: ReportStreamSessionTimelineDocument,
      variables,
      context: { fetchOptions: { signal: reportCancellation.signal } },
      update: (cache, { data }) => {
        if (data?.reportStreamSessionTimeline) discardWatchedState(cache)
      },
      onQueryUpdated: refetchWatchedQuery,
    })
  }

  let playRequested = false
  function trackTimeline() {
    return attachTimeline(video, {
      // Seeking before metadata is loaded is unreliable across browsers; the event is the safe point.
      onLoadedMetadata: (element) => {
        if (resume) {
          const previous = resume
          resume = undefined
          element.currentTime = previous.position
          if (previous.playing) void element.play().catch(ignoreRefusedStart)
          return
        }
        if (startPositionSeconds) {
          element.currentTime = startPositionSeconds
        }
        // Before metadata, only the viewer can ask to play. Their choice stands, even a later Pause.
        if (playRequested) {
          return
        }
        // Asked only after the seek, so the first frame to play is at the start position.
        void element.play().catch(ignoreRefusedStart)
      },
      onPlay: () => {
        if (resume) resume.playing = true
        playRequested = true
      },
      onTimeUpdate: (element) => {
        lastKnownPosition = element.currentTime
        if (
          Math.abs(element.currentTime - lastReportedPosition) < TIMELINE_REPORT_INTERVAL_SECONDS
        ) {
          return
        }
        lastReportedPosition = element.currentTime
        report('PLAYING', element.currentTime)
      },
      onPause: (element) => {
        if (resume) resume.playing = false
        lastKnownPosition = element.currentTime
        report('PAUSED', element.currentTime)
      },
      onEnded: (element) => {
        const endedAt = element.currentTime
        lastKnownPosition = endedAt
        unacknowledgedEndPosition = endedAt
        // A replay can move the playhead while an earlier report holds the queue.
        reportStopped(() => endedAt)
      },
    })
  }
  let timeline = trackTimeline()

  function expireStartup() {
    cancelled = true
    statusCancellation.abort()
    stopStatusCheck()
    detachSource()
    onSourcePhase({ at: 'failed', message: 'Playback is taking too long to start. Try again.' })
    requestCleanup()
  }
  let startupDeadline = createStartupDeadline(expireStartup)
  const startup = Promise.resolve()
    .then(async () => {
      await previousCleanup?.()
      previousCleanup = undefined
      if (cancelled) {
        return
      }
      // The UI deadline must not discard a late session ID that still needs destruction.
      const result = await createPlaybackSession()
      const payload = result.data?.createPlaybackSession
      const initialPlayback = payload?.playbackSession
      playbackSessionId = initialPlayback?.id ?? null
      if (cancelled) {
        return
      }
      if (!initialPlayback) {
        showFailure(refusalMessage(payload))
        return
      }
      const playback = await awaitReadyPlayback(initialPlayback)
      if (cancelled) {
        return
      }
      adoptPlayback(playback)
    })
    .catch(() => {
      if (!cancelled) {
        showFailure(PLAYBACK_FAILURE_MESSAGE)
      }
    })

  function adoptPlayback(playback: PlaybackSessionFieldsFragment | null | undefined) {
    const attempt = playback?.currentFormatAttempt
    if (attempt?.__typename === 'FailedPlaybackFormatAttempt') {
      showFailure(userErrorMessage(attempt.error))
      return
    }
    if (attempt?.__typename !== 'ReadyPlaybackFormatAttempt') {
      showFailure(PLAYBACK_FAILURE_MESSAGE)
      return
    }
    sessionId = attempt.streamSession.id
    const generation = sourceGeneration
    timeline.detach()
    timeline = trackTimeline()
    source = attach(video, attempt.streamSession.streamUrl, {
      startupDeadline,
      onFormatFailure: (reason) => {
        void reportFormatFailure(reason, generation)
      },
      onStatusRequired: (fatal) => {
        void reconcilePlaybackStatus({ generation, fatal })
      },
      onFatal: () => {
        if (cancelled || generation !== sourceGeneration) return
        stopStatusCheck()
        detachSource()
        showFailure(PLAYBACK_FAILURE_MESSAGE)
      },
    })
    onSourcePhase({ at: 'attached', tracks: source.tracks })
  }

  async function reportFormatFailure(reason: PlaybackFormatFailure, generation: number) {
    if (
      cancelled ||
      generation !== sourceGeneration ||
      reportingFormat ||
      !playbackSessionId ||
      !sessionId
    )
      return
    reportingFormat = true
    const streamSessionId = sessionId
    stopStatusCheck()
    beginHandover()
    try {
      const result = await client.mutate({
        mutation: ReportPlaybackFormatFailureDocument,
        variables: { input: { playbackSessionId, streamSessionId, reason } },
        fetchPolicy: 'no-cache',
        context: { fetchOptions: { signal: statusCancellation.signal } },
      })
      if (cancelled) return
      const payload = result.data?.reportPlaybackFormatFailure
      if (!payload?.playbackSession) {
        showFailure(refusalMessage(payload))
        return
      }
      const playback = await awaitReadyPlayback(payload.playbackSession)
      if (cancelled) return
      reportingFormat = false
      adoptPlayback(playback)
    } catch {
      if (!cancelled) showFailure(PLAYBACK_FAILURE_MESSAGE)
    } finally {
      reportingFormat = false
    }
  }

  function beginHandover() {
    resume ??= {
      position:
        video.readyState >= HTMLMediaElement.HAVE_METADATA
          ? video.currentTime
          : (startPositionSeconds ?? video.currentTime),
      playing: !playRequested || !video.paused,
    }
    detachSource()
    sessionId = null
    startupDeadline.end()
    startupDeadline = createStartupDeadline(expireStartup)
    onSourcePhase({ at: 'starting' })
  }

  function stopStatusCheck() {
    const previous = statusCheck
    statusCheck = undefined
    previous?.controller.abort()
  }

  async function reconcilePlaybackStatus({
    generation,
    fatal,
  }: {
    generation: number
    fatal: boolean
  }) {
    if (cancelled || generation !== sourceGeneration || reportingFormat || !playbackSessionId)
      return
    if (statusCheck) {
      statusCheck.fatal ||= fatal
      return
    }
    const check = { controller: new AbortController(), generation, fatal }
    statusCheck = check
    const current = () =>
      !cancelled && statusCheck === check && check.generation === sourceGeneration
    const deadline = setTimeout(() => check.controller.abort(), PLAYBACK_START_TIMEOUT_MS)
    try {
      while (current() && !check.controller.signal.aborted) {
        const result = await client.query({
          query: PlaybackSessionDocument,
          variables: { id: playbackSessionId },
          fetchPolicy: 'no-cache',
          context: { fetchOptions: { signal: check.controller.signal } },
        })
        if (!current()) return
        const playback = result.data?.playbackSession
        const attempt = playback?.currentFormatAttempt
        if (
          attempt?.__typename === 'ReadyPlaybackFormatAttempt' &&
          attempt.streamSession.id === sessionId
        ) {
          // The worker wakes HTTP waiters before publishing the logical replacement event.
          await waitForPlaybackStatus(check.controller.signal)
          continue
        }
        beginHandover()
        check.generation = sourceGeneration
        const resolved = playback
          ? await awaitReadyPlayback(playback, check.controller.signal, current)
          : undefined
        if (!current()) return
        if (check.controller.signal.aborted) break
        adoptPlayback(resolved)
        return
      }
      if (current() && check.fatal) failSource()
    } catch {
      if (current() && check.fatal) failSource()
    } finally {
      clearTimeout(deadline)
      if (statusCheck === check) statusCheck = undefined
    }
  }

  function failSource() {
    detachSource()
    showFailure(PLAYBACK_FAILURE_MESSAGE)
  }

  async function awaitReadyPlayback(
    initial: PlaybackSessionFieldsFragment,
    signal = statusCancellation.signal,
    current = () => !cancelled,
  ) {
    let playback: PlaybackSessionFieldsFragment | null | undefined = initial
    while (
      current() &&
      !signal.aborted &&
      playback?.currentFormatAttempt.__typename === 'PendingPlaybackFormatAttempt'
    ) {
      const result = await client.query({
        query: PlaybackSessionDocument,
        variables: { id: initial.id },
        fetchPolicy: 'no-cache',
        context: { fetchOptions: { signal } },
      })
      if (!current()) {
        return undefined
      }
      playback = result.data?.playbackSession
      if (playback?.currentFormatAttempt.__typename === 'PendingPlaybackFormatAttempt') {
        await waitForPlaybackStatus(signal)
      }
    }
    return playback
  }

  function showFailure(message: string) {
    startupDeadline.end()
    onSourcePhase({ at: 'failed', message })
  }

  function releaseSession(): Promise<void> {
    if (cleanupInFlight) {
      return cleanupInFlight
    }
    cleanupInFlight = finishCleanup().finally(() => {
      cleanupInFlight = undefined
    })
    return cleanupInFlight
  }

  async function finishCleanup() {
    await startup
    await previousCleanup?.()
    previousCleanup = undefined
    const deadline = setTimeout(() => reportCancellation.abort(), TIMELINE_CLEANUP_TIMEOUT_MS)
    await timelineReports.finally(() => clearTimeout(deadline))
    if (playbackSessionId) {
      await destroySession(playbackSessionId)
      playbackSessionId = null
      sessionId = null
    }
    if (pendingCleanups.get(client) === releaseSession) {
      pendingCleanups.delete(client)
    }
  }

  function detachSource() {
    sourceGeneration += 1
    // Releasing the stream rewinds the element; the timeline must not record the rewind.
    timeline.detach()
    source?.detach()
    source = null
  }

  function requestCleanup() {
    // A failed or pending destroy retains ownership; a later startup can retry the same cleanup.
    pendingCleanups.set(client, releaseSession)
    void releaseSession().catch(() => undefined)
  }

  return () => {
    cancelled = true
    statusCancellation.abort()
    stopStatusCheck()
    startupDeadline.end()
    reportStopped(() => unacknowledgedEndPosition)
    reportStopped(() => lastKnownPosition)
    detachSource()
    requestCleanup()
  }
}

function waitForPlaybackStatus(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, PLAYBACK_STATUS_INTERVAL_MS)
    signal.addEventListener('abort', finish, { once: true })
  })
}

type TimelineHandler = (video: HTMLVideoElement) => void

function refetchWatchedQuery(query: ObservableQuery) {
  // UI refreshes must not hold the report queue or session disposal open.
  void query.refetch().catch(() => undefined)
  return false
}

function attachTimeline(
  video: HTMLVideoElement,
  handlers: {
    onLoadedMetadata: TimelineHandler
    onTimeUpdate: TimelineHandler
    onPlay: TimelineHandler
    onPause: TimelineHandler
    onEnded: TimelineHandler
  },
): { detach: () => void } {
  const onLoadedMetadata = () => handlers.onLoadedMetadata(video)
  const onTimeUpdate = () => handlers.onTimeUpdate(video)
  const onPlay = () => handlers.onPlay(video)
  const onPause = () => handlers.onPause(video)
  const onEnded = () => handlers.onEnded(video)
  video.addEventListener('loadedmetadata', onLoadedMetadata)
  video.addEventListener('timeupdate', onTimeUpdate)
  video.addEventListener('play', onPlay)
  video.addEventListener('pause', onPause)
  video.addEventListener('ended', onEnded)
  return {
    detach: () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
    },
  }
}

interface StartupDeadline {
  end: () => void
  hold: () => void
  rearm: () => void
}

type StartupPhase =
  { at: 'armed'; timer: ReturnType<typeof setTimeout> } | { at: 'held' } | { at: 'ended' }

function createStartupDeadline(onExpired: () => void): StartupDeadline {
  let phase = arm()

  function arm(): StartupPhase {
    const timer = setTimeout(() => {
      phase = { at: 'ended' }
      onExpired()
    }, PLAYBACK_START_TIMEOUT_MS)
    return { at: 'armed', timer }
  }

  return {
    end: () => {
      if (phase.at === 'armed') {
        clearTimeout(phase.timer)
      }
      phase = { at: 'ended' }
    },
    hold: () => {
      if (phase.at !== 'armed') {
        return
      }
      clearTimeout(phase.timer)
      phase = { at: 'held' }
    },
    rearm: () => {
      if (phase.at !== 'held') {
        return
      }
      phase = arm()
    },
  }
}

function refusalMessage(payload: PlaybackSessionPayload | undefined): string {
  const refusal = payload?.userErrors[0]
  return refusal ? userErrorMessage(refusal) : PLAYBACK_FAILURE_MESSAGE
}

function ignoreRefusedStart() {
  // A browser may refuse to start playback until the viewer interacts with the page, and a released
  // stream interrupts the start. The element stays paused either way, and the controls show it.
}

function ignoreTimelineReportFailure() {
  // A missed progress report costs nothing the next one doesn't restore, and playback must never
  // surface it.
}

interface StreamSource {
  detach: () => void
  tracks: TrackSource
}

interface StreamSourceOptions {
  onFatal: () => void
  onFormatFailure: (reason: PlaybackFormatFailure) => void
  onStatusRequired: (fatal: boolean) => void
  startupDeadline: StartupDeadline
}

// The stream URL carries the playback ?t= token; relative segment requests inherit it.
function attach(video: HTMLVideoElement, url: string, options: StreamSourceOptions): StreamSource {
  if (!Hls.isSupported()) {
    return attachNative(video, url, options)
  }
  const hls = new Hls()
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.response?.code === 503) {
      options.onStatusRequired(data.fatal)
      return
    }
    if (!data.fatal) {
      return
    }
    if (isUnsupportedFormat(data)) {
      options.onFormatFailure('UNSUPPORTED_FORMAT')
      return
    }
    options.onFatal()
  })
  const onVideoError = () => handleVideoError(video, options)
  video.addEventListener('error', onVideoError)
  video.addEventListener('loadedmetadata', options.startupDeadline.end)
  hls.loadSource(url)
  hls.attachMedia(video)
  return {
    detach: () => {
      video.removeEventListener('loadedmetadata', options.startupDeadline.end)
      video.removeEventListener('error', onVideoError)
      hls.destroy()
    },
    tracks: hlsTrackSource(hls),
  }
}

function handleVideoError(video: HTMLVideoElement, options: StreamSourceOptions) {
  switch (video.error?.code) {
    case 3:
      options.onFormatFailure('DECODE_ERROR')
      return
    case 4:
      options.onStatusRequired(true)
      return
    default:
      options.onFatal()
  }
}

function isUnsupportedFormat(data: ErrorData): boolean {
  if (data.type !== Hls.ErrorTypes.MEDIA_ERROR) return false
  switch (data.details) {
    case Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR:
    case Hls.ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR:
      return true
    case Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR:
      return data.error.name === 'NotSupportedError'
    default:
      return false
  }
}

// Without MSE the element plays HLS itself and reports failure only through its error event.
function attachNative(
  video: HTMLVideoElement,
  url: string,
  options: StreamSourceOptions,
): StreamSource {
  const { startupDeadline } = options
  const onVideoError = () => handleVideoError(video, options)
  // WebKit loads metadata from the playlists alone, so startup ends on the first frame. A browser
  // may withhold that frame until the viewer presses play, so a suspend while paused holds startup
  // until then. A playing element that suspends is still owed its first frame.
  const holdWhilePaused = () => {
    if (video.paused) {
      startupDeadline.hold()
    }
  }
  video.addEventListener('error', onVideoError)
  video.addEventListener('loadeddata', startupDeadline.end)
  video.addEventListener('suspend', holdWhilePaused)
  video.addEventListener('play', startupDeadline.rearm)
  video.src = url
  return {
    detach: () => {
      video.removeEventListener('error', onVideoError)
      video.removeEventListener('loadeddata', startupDeadline.end)
      video.removeEventListener('suspend', holdWhilePaused)
      video.removeEventListener('play', startupDeadline.rearm)
      // The same reset hls.js performs on detach: the element stops fetching the stream.
      video.removeAttribute('src')
      video.load()
    },
    tracks: nativeTrackSource(video),
  }
}
