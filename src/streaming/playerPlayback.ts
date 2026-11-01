import type { ApolloClient, ObservableQuery } from '@apollo/client'
import Hls, { type ErrorData } from 'hls.js'
import {
  type ClientCapabilityDeclarationInput,
  type CreatePlaybackSessionMutation,
  DestroyPlaybackSessionDocument,
  PlaybackSessionDocument,
  type PlaybackSessionFieldsFragment,
  type PlaybackFormatFailure,
  ReportPlaybackFormatFailureDocument,
  ReportStreamSessionTimelineDocument,
  type ReportStreamSessionTimelineMutationVariables,
  type VideoRange,
} from '../graphql/generated/graphql'
import { userErrorMessage, userErrorMessageOr } from '../graphql/userErrors'
import { discardWatchedState } from '../media/watchedState'
import { hlsPlaybackConfig } from './hlsPlaybackConfig'
import { DECLARATION_REFUSAL_TYPENAMES } from './playbackCapabilities'
import type { QualityChoices } from './qualityChoices'
import { hlsTrackSource, nativeTrackSource, type TrackSource } from './trackSources'

// Progress is only worth a round trip once the playhead has moved this far since the last report.
const TIMELINE_REPORT_INTERVAL_SECONDS = 10
const TIMELINE_CLEANUP_TIMEOUT_MS = 10_000
const PLAYBACK_START_TIMEOUT_MS = 30_000
const PLAYBACK_STATUS_INTERVAL_MS = 500
// The server's default target segment duration, for a player that keeps the playlist to itself.
const DEFAULT_SEGMENT_SECONDS = 6

const PLAYBACK_FAILURE_MESSAGE = "Playback couldn't start. Try again."
const FAILED_ATTEMPT_FALLBACK_MESSAGE = "This video can't be played right now. Try again later."

type PlaybackState = ReportStreamSessionTimelineMutationVariables['state']
type PlaybackSessionPayload = CreatePlaybackSessionMutation['createPlaybackSession']

export type SourcePhase =
  | { at: 'starting' }
  | { at: 'attached'; tracks: TrackSource; qualities: QualityChoices; videoRange: VideoRange }
  | { at: 'failed'; message: string }

/** Where playback picks up on a new stream: the playhead, and whether it plays on from there. */
export interface ResumePoint {
  position: number
  playing: boolean
}

export interface PlayerPlayback {
  /** Leaves playback: reports the final position and releases the playback session. */
  stop: () => void
  /** Where a playback session started in this one's place should resume. */
  resumePoint: () => ResumePoint
}

interface PlaybackStatusCheck {
  controller: AbortController
  generation: number
  fatal: boolean
}

interface PlayerPlaybackOptions {
  video: HTMLVideoElement
  client: ApolloClient
  declareCapabilities: () => Promise<ClientCapabilityDeclarationInput>
  createPlaybackSession: (
    capabilities: ClientCapabilityDeclarationInput,
  ) => Promise<{ data?: CreatePlaybackSessionMutation | null }>
  startPositionSeconds?: number
  /** Takes the place of the start position when this playback replaces one the viewer was watching. */
  resumeFrom?: ResumePoint
  onSourcePhase: (phase: SourcePhase) => void
  /** Called once each attached stream shows its first frame, with the choices that stream plays. */
  onOutputShown: (qualities: QualityChoices) => void
}

interface SessionPlayback extends PlayerPlayback {
  leavePage: () => ResumePoint | undefined
}

const pendingCleanups = new WeakMap<ApolloClient, () => Promise<void>>()

// React never unmounts a page the browser unloads or keeps in its back-forward cache, so the page
// lifecycle, not the Player effect, has to end the session when the viewer leaves the page.
export function startPlayerPlayback(options: PlayerPlaybackOptions): PlayerPlayback {
  let playback = startSessionPlayback(options)
  let left: ResumePoint | undefined
  const onPageHide = () => {
    left = playback.leavePage()
  }
  // Only a page restored from the back-forward cache shows again after it was hidden.
  const onPageShow = () => {
    if (!left) {
      return
    }
    const resumeFrom = left
    left = undefined
    options.onSourcePhase({ at: 'starting' })
    playback = startSessionPlayback({ ...options, resumeFrom })
  }
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  return {
    stop: () => {
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      playback.stop()
    },
    resumePoint: () => playback.resumePoint(),
  }
}

function startSessionPlayback({
  video,
  client,
  declareCapabilities,
  createPlaybackSession,
  startPositionSeconds,
  onSourcePhase,
  onOutputShown,
  resumeFrom,
}: PlayerPlaybackOptions): SessionPlayback {
  let source: StreamSource | null = null
  let cancelled = false
  let sessionId: string | null = null
  let playbackSessionId: string | null = null
  let sourceGeneration = 0
  let reportingFormat = false
  let statusCheck: PlaybackStatusCheck | undefined
  const startAt = resumeFrom?.position ?? startPositionSeconds
  let resume: ResumePoint | undefined = resumeFrom && { ...resumeFrom }
  let lastReportedPosition = startAt ?? 0
  let lastKnownPosition: number | null = null
  let unacknowledgedEndPosition: number | null = null
  // Where the attached stream's media really ends, when its copy ran short of the advertised end.
  let realEnd: number | null = null
  let endedAtRealEnd = false
  // Where the playhead stopped when playback ended; a viewer's seek after the end moves it away.
  let endedPosition = 0
  // hls.js stops loading after a fatal error, so a failure that ended playback leaves the stream
  // to attach again before it can play.
  let attachedPlayback: PlaybackSessionFieldsFragment | null = null
  let timelineReports = Promise.resolve()
  const reportCancellation = new AbortController()
  const statusCancellation = new AbortController()
  let previousCleanup = pendingCleanups.get(client)
  let cleanupInFlight: Promise<void> | undefined
  let destroyOnLeavingPage: Promise<void> | undefined
  let destroyingOnLeavingPage = false

  async function destroySession(id: string, { keepalive = false } = {}) {
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), PLAYBACK_START_TIMEOUT_MS)
    const result = await client
      .mutate({
        mutation: DestroyPlaybackSessionDocument,
        variables: { input: { playbackSessionId: id } },
        context: { fetchOptions: { signal: controller.signal, keepalive } },
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

  // A resume carries the viewer's own play or pause, so the start never decides it for them.
  let playRequested = resumeFrom !== undefined
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
        if (startAt) {
          element.currentTime = startAt
        }
        // Before metadata, only the viewer can ask to play. Their choice stands, even a later Pause.
        if (playRequested) {
          return
        }
        // Asked only after the seek, so the first frame to play is at the start position.
        void element.play().catch(ignoreRefusedStart)
      },
      onPlay: (element) => {
        if (resume) resume.playing = true
        playRequested = true
        if (!endedAtRealEnd) return
        // As the element does after its own end, playing where playback ended starts from the top.
        if (element.currentTime === endedPosition) element.currentTime = 0
        // A failure can be what ended playback, and hls.js stops loading after one.
        restartStoppedSource(element.currentTime)
      },
      // The pause that ends playback reports its events after the end; the end stays the last word.
      onTimeUpdate: (element) => {
        if (endedAtRealEnd) return
        lastKnownPosition = element.currentTime
        if (realEnd !== null && element.currentTime >= realEnd) {
          endAtRealEnd()
          return
        }
        if (
          Math.abs(element.currentTime - lastReportedPosition) < TIMELINE_REPORT_INTERVAL_SECONDS
        ) {
          return
        }
        lastReportedPosition = element.currentTime
        report('PLAYING', element.currentTime)
      },
      onPause: (element) => {
        if (endedAtRealEnd) return
        if (resume) resume.playing = false
        lastKnownPosition = element.currentTime
        report('PAUSED', element.currentTime)
      },
      // A seek waits for its own data, which can still come; only a stall in playback is an end.
      onWaiting: (element) => {
        if (!element.seeking) tryEndAtRealEnd()
      },
      onEnded: (element) => reportEnd(element.currentTime),
    })
  }

  function reportEnd(endedAt: number) {
    lastKnownPosition = endedAt
    unacknowledgedEndPosition = endedAt
    // A replay can move the playhead while an earlier report holds the queue.
    reportStopped(() => endedAt)
  }

  // The last segment of a short copy can hold less media than its advertised length, so the
  // element may stall up to one segment before the real end.
  function withinASegmentOfRealEnd(): boolean {
    const segmentSeconds = source?.segmentSeconds() ?? DEFAULT_SEGMENT_SECONDS
    return realEnd !== null && video.currentTime >= realEnd - segmentSeconds
  }

  // Ends playback as at the end of the media title, once for each time the playhead gets there.
  function endAtRealEnd() {
    if (realEnd === null || endedAtRealEnd) {
      return
    }
    endedAtRealEnd = true
    stopStatusCheck()
    video.pause()
    endedPosition = video.currentTime
    reportEnd(realEnd)
  }

  function restartStoppedSource(position: number) {
    resume = { position, playing: true }
    detachSource()
    adoptPlayback(attachedPlayback)
  }

  // Nothing past the real end can arrive, so a stall or a failure close to it is the end. A
  // failure after the end, even once the viewer has sought back, belongs to the ended playback.
  function tryEndAtRealEnd(): boolean {
    if (endedAtRealEnd) {
      return true
    }
    if (!withinASegmentOfRealEnd()) {
      return false
    }
    endAtRealEnd()
    return true
  }

  // The server named the real end only after the playhead may have reached it and stalled there.
  function learnRealEnd(seconds: number) {
    realEnd = seconds
    if (video.seeking) {
      return
    }
    if (video.currentTime >= seconds || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      tryEndAtRealEnd()
    }
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
      // Leaving abandons the probes, so the next player's start never waits out their deadline.
      const capabilities = await unlessAborted(declareCapabilities(), statusCancellation.signal)
      if (cancelled || !capabilities) {
        return
      }
      // The server requires a video entry, so a browser that decodes no video cannot play here.
      if (capabilities.video.length === 0) {
        showFailure(PLAYBACK_FAILURE_MESSAGE)
        return
      }
      // The UI deadline must not discard a late session ID that still needs destruction.
      const result = await createPlaybackSession(capabilities)
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
      showFailure(userErrorMessageOr(attempt.error, FAILED_ATTEMPT_FALLBACK_MESSAGE))
      return
    }
    if (!playback || attempt?.__typename !== 'ReadyPlaybackFormatAttempt') {
      showFailure(PLAYBACK_FAILURE_MESSAGE)
      return
    }
    // The same stream attached again keeps the real end a status check named for it.
    const sameStream = attempt.streamSession.id === sessionId
    sessionId = attempt.streamSession.id
    attachedPlayback = playback
    realEnd = attempt.streamSession.mediaEndSeconds ?? (sameStream ? realEnd : null)
    endedAtRealEnd = false
    const generation = sourceGeneration
    timeline.detach()
    timeline = trackTimeline()
    const qualities: QualityChoices = {
      offered: playback.offeredChoices,
      requested: playback.requestedChoice,
      playing: playback.playbackChoice,
      formatChange: playback.formatChange,
    }
    source = attach(video, attempt.streamSession.streamUrl, {
      startupDeadline,
      onFirstFrame: () => onOutputShown(qualities),
      onFormatFailure: (reason) => {
        void reportFormatFailure(reason, generation)
      },
      onStatusRequired: (fatal) => {
        void reconcilePlaybackStatus({ generation, fatal })
      },
      onFatal: () => {
        if (cancelled || generation !== sourceGeneration) return
        if (tryEndAtRealEnd()) return
        stopStatusCheck()
        detachSource()
        showFailure(PLAYBACK_FAILURE_MESSAGE)
      },
    })
    onSourcePhase({
      at: 'attached',
      tracks: source.tracks,
      qualities,
      videoRange: attempt.streamSession.videoRange,
    })
  }

  async function reportFormatFailure(reason: PlaybackFormatFailure, generation: number) {
    if (
      cancelled ||
      generation !== sourceGeneration ||
      reportingFormat ||
      !playbackSessionId ||
      !sessionId ||
      tryEndAtRealEnd()
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

  function currentResumePoint(): ResumePoint {
    return {
      position:
        video.readyState >= HTMLMediaElement.HAVE_METADATA
          ? video.currentTime
          : (startAt ?? video.currentTime),
      playing: !playRequested || !video.paused,
    }
  }

  function beginHandover() {
    resume = resumePoint()
    detachSource()
    sessionId = null
    startupDeadline.end()
    startupDeadline = createStartupDeadline(expireStartup)
    onSourcePhase({ at: 'starting' })
  }

  // Where the next stream should pick up: a resume still waiting for metadata stands.
  function resumePoint(): ResumePoint {
    if (resume) {
      return { ...resume }
    }
    return currentResumePoint()
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
    if (
      cancelled ||
      generation !== sourceGeneration ||
      reportingFormat ||
      !playbackSessionId ||
      endedAtRealEnd
    )
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
      await pollForReplacement({ check, current, id: playbackSessionId })
      if (current() && check.controller.signal.aborted && check.fatal) failSource()
    } catch {
      if (current() && check.fatal) failSource()
    } finally {
      clearTimeout(deadline)
      if (statusCheck === check) statusCheck = undefined
    }
  }

  async function pollForReplacement({
    check,
    current,
    id,
  }: {
    check: PlaybackStatusCheck
    current: () => boolean
    id: string
  }) {
    while (current() && !check.controller.signal.aborted) {
      const result = await client.query({
        query: PlaybackSessionDocument,
        variables: { id },
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
        // The segments past a short copy's real end never come, and nothing replaces the stream.
        if (attempt.streamSession.mediaEndSeconds !== null) {
          learnRealEnd(attempt.streamSession.mediaEndSeconds)
          return
        }
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
    // A destroy that failed while the page was hidden leaves the ID in place for this one to retry.
    await destroyOnLeavingPage
    if (playbackSessionId) {
      await destroySession(playbackSessionId)
      playbackSessionId = null
      sessionId = null
    }
    window.removeEventListener('pagehide', destroyBeforeThePageGoes)
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

  function endPlayback() {
    cancelled = true
    statusCancellation.abort()
    stopStatusCheck()
    startupDeadline.end()
  }

  // The browser cancels an ordinary request when it unloads the page, and the page runs no more
  // script once it is gone, so the destroy goes out at once with keepalive, ahead of any reports.
  // The session playback listens until its session is released, because a stopped one may still
  // hold it after the Player has gone.
  function destroyBeforeThePageGoes() {
    // A report that reaches the server after the destroy only meets a closed session.
    reportCancellation.abort()
    const id = playbackSessionId
    if (!id || destroyingOnLeavingPage) {
      return
    }
    destroyingOnLeavingPage = true
    destroyOnLeavingPage = destroySession(id, { keepalive: true })
      .then(
        () => {
          playbackSessionId = null
        },
        () => undefined,
      )
      .finally(() => {
        destroyingOnLeavingPage = false
      })
  }
  window.addEventListener('pagehide', destroyBeforeThePageGoes)

  function leavePage(): ResumePoint | undefined {
    const left = cancelled ? undefined : resumePoint()
    endPlayback()
    detachSource()
    destroyBeforeThePageGoes()
    requestCleanup()
    return left
  }

  return {
    stop: () => {
      endPlayback()
      reportStopped(() => unacknowledgedEndPosition)
      reportStopped(() => lastKnownPosition)
      detachSource()
      requestCleanup()
    },
    resumePoint,
    leavePage,
  }
}

// Resolves undefined once the signal aborts; a signal aborted before the call waits for the work.
function unlessAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const abandon = () => resolve(undefined)
    signal.addEventListener('abort', abandon, { once: true })
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abandon))
  })
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
    onWaiting: TimelineHandler
    onEnded: TimelineHandler
  },
): { detach: () => void } {
  const onLoadedMetadata = () => handlers.onLoadedMetadata(video)
  const onTimeUpdate = () => handlers.onTimeUpdate(video)
  const onPlay = () => handlers.onPlay(video)
  const onPause = () => handlers.onPause(video)
  const onWaiting = () => handlers.onWaiting(video)
  const onEnded = () => handlers.onEnded(video)
  video.addEventListener('loadedmetadata', onLoadedMetadata)
  video.addEventListener('timeupdate', onTimeUpdate)
  video.addEventListener('play', onPlay)
  video.addEventListener('pause', onPause)
  video.addEventListener('waiting', onWaiting)
  video.addEventListener('ended', onEnded)
  return {
    detach: () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onWaiting)
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
  if (!refusal || DECLARATION_REFUSAL_TYPENAMES.has(refusal.__typename)) {
    return PLAYBACK_FAILURE_MESSAGE
  }
  return userErrorMessage(refusal)
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
  /** The playlist's target segment duration, when the player can read it. */
  segmentSeconds: () => number | undefined
}

interface StreamSourceOptions {
  onFatal: () => void
  onFirstFrame: () => void
  onFormatFailure: (reason: PlaybackFormatFailure) => void
  onStatusRequired: (fatal: boolean) => void
  startupDeadline: StartupDeadline
}

// The stream URL carries the playback ?t= token; relative segment requests inherit it.
function attach(video: HTMLVideoElement, url: string, options: StreamSourceOptions): StreamSource {
  if (!Hls.isSupported()) {
    return attachNative(video, url, options)
  }
  const hls: Hls = new Hls(hlsPlaybackConfig(() => hls))
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
  video.addEventListener('loadeddata', options.onFirstFrame, { once: true })
  hls.loadSource(url)
  hls.attachMedia(video)
  return {
    detach: () => {
      video.removeEventListener('loadeddata', options.onFirstFrame)
      video.removeEventListener('loadedmetadata', options.startupDeadline.end)
      video.removeEventListener('error', onVideoError)
      hls.destroy()
    },
    tracks: hlsTrackSource(hls),
    segmentSeconds: () => hls.latestLevelDetails?.targetduration,
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
  const { startupDeadline, onFirstFrame } = options
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
  video.addEventListener('loadeddata', onFirstFrame, { once: true })
  video.addEventListener('suspend', holdWhilePaused)
  video.addEventListener('play', startupDeadline.rearm)
  video.src = url
  return {
    detach: () => {
      video.removeEventListener('error', onVideoError)
      video.removeEventListener('loadeddata', startupDeadline.end)
      video.removeEventListener('loadeddata', onFirstFrame)
      video.removeEventListener('suspend', holdWhilePaused)
      video.removeEventListener('play', startupDeadline.rearm)
      // The same reset hls.js performs on detach: the element stops fetching the stream.
      video.removeAttribute('src')
      video.load()
    },
    tracks: nativeTrackSource(video),
    segmentSeconds: () => undefined,
  }
}
