import type { ApolloClient, ObservableQuery } from '@apollo/client'
import Hls, { type ErrorData, type VideoSelectionOption } from 'hls.js'
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
  SwitchPlaybackAudioTrackDocument,
  type SwitchPlaybackAudioTrackInput,
  type VideoRange,
} from '../graphql/generated/graphql'
import { userErrorMessage, userErrorMessageOr } from '../graphql/userErrors'
import { discardWatchedState } from '../media/watchedState'
import { hlsPlaybackConfig } from './hlsPlaybackConfig'
import { type DynamicRangeChoice, hlsVideoPreference } from './hlsVideoPreference'
import { DECLARATION_REFUSAL_TYPENAMES } from './playbackCapabilities'
import type { QualityChoices } from './qualityChoices'
import {
  hlsTrackSource,
  type ListedAudioTrack,
  listedAudioTrackSource,
  nativeTrackSource,
  type TrackSource,
} from './trackSources'

// Progress is only worth a round trip once the playhead has moved this far since the last report.
const TIMELINE_REPORT_INTERVAL_SECONDS = 10
const TIMELINE_CLEANUP_TIMEOUT_MS = 10_000
const PLAYBACK_START_TIMEOUT_MS = 30_000
const PLAYBACK_STATUS_INTERVAL_MS = 500
// The server's default target segment duration, for a player that keeps the playlist to itself.
const DEFAULT_SEGMENT_SECONDS = 6
// By the server's defaults, it replaces a job attempt that stores nothing for 10 s and gives the
// replacement up to 22 s to store its first segment, so a stall it can still end ends within about
// 32 s and one segment's transfer. Once the buffer is empty, hls.js abandons a segment request
// whose first byte takes 10 s and may ask another variant for the segment, which starts the
// server's count again, so no request may live to hear the server give up on the segment.
const STALL_LIMIT_MS = 45_000

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
  /**
   * Moves the playhead for the viewer. A running stall limit starts again at once, and the
   * element's seeking event starts the seek's own limit.
   */
  seek: (seconds: number) => void
  /**
   * Asks hls.js for the viewer's HDR choice, which starts as HDR. hls.js keeps the range it
   * started on, so a changed choice attaches the stream again at the playhead. A stream with no SDR
   * variant still plays HDR after an SDR choice, until the server can be asked for SDR.
   */
  chooseDynamicRange: (choice: DynamicRangeChoice) => void
}

// An audio track switch the server has not answered yet, and the failures of the source it
// replaces that wait for the answer. A stall that outlasted its limit counts only while it lasts.
interface PendingAudioTrackSwitch {
  generation: number
  formatFailure: PlaybackFormatFailure | null
  failed: boolean
  stalled: boolean
}

type AudioTrackSwitchAnswer =
  | { kind: 'started'; playback: PlaybackSessionFieldsFragment }
  | { kind: 'kept' }
  | { kind: 'refused'; message: string }
  | { kind: 'lost' }

// A stall's limit, and the status read once the stall outlasts it.
interface Stall {
  timer: ReturnType<typeof setTimeout>
  controller: AbortController
}

interface PlaybackStatusCheck {
  controller: AbortController
  generation: number
  fatal: boolean
  settled: Promise<void>
}

/** What the player asks of a new playback session; no start position starts at the beginning. */
interface PlaybackSessionRequest {
  capabilities: ClientCapabilityDeclarationInput
  startPositionSeconds?: number
}

interface PlayerPlaybackOptions {
  video: HTMLVideoElement
  client: ApolloClient
  declareCapabilities: () => Promise<ClientCapabilityDeclarationInput>
  createPlaybackSession: (
    request: PlaybackSessionRequest,
  ) => Promise<{ data?: CreatePlaybackSessionMutation | null }>
  startPositionSeconds?: number
  /** Takes the place of the start position when this playback replaces one the viewer was watching. */
  resumeFrom?: ResumePoint
  onSourcePhase: (phase: SourcePhase) => void
  /** Called once each attached stream shows its first frame, with the choices that stream plays. */
  onOutputShown: (qualities: QualityChoices) => void
  /** Shows the server's words when it refuses something the viewer asked for while playback goes on. */
  onNotice: (text: string) => void
}

interface SessionPlayback extends PlayerPlayback {
  leavePage: () => ResumePoint | undefined
}

const pendingCleanups = new WeakMap<ApolloClient, () => Promise<void>>()

// React never unmounts a page the browser unloads or keeps in its back-forward cache, so the page
// lifecycle, not the Player effect, has to end the session when the viewer leaves the page.
export function startPlayerPlayback(options: PlayerPlaybackOptions): PlayerPlayback {
  let dynamicRange: DynamicRangeChoice = 'HDR'
  let playback = startSessionPlayback({ ...options, dynamicRange })
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
    playback = startSessionPlayback({ ...options, resumeFrom, dynamicRange })
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
    seek: (seconds) => playback.seek(seconds),
    chooseDynamicRange: (choice) => {
      dynamicRange = choice
      playback.chooseDynamicRange(choice)
    },
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
  onNotice,
  resumeFrom,
  dynamicRange: initialDynamicRange,
}: PlayerPlaybackOptions & { dynamicRange: DynamicRangeChoice }): SessionPlayback {
  let source: StreamSource | null = null
  let declaration: ClientCapabilityDeclarationInput = {
    video: [],
    audio: [],
    selectsAudioTrackInDirectPlay: false,
  }
  let dynamicRange = initialDynamicRange
  let cancelled = false
  let pendingSwitch: PendingAudioTrackSwitch | null = null
  let sessionId: string | null = null
  let playbackSessionId: string | null = null
  let sourceGeneration = 0
  let reportingFormat = false
  let statusCheck: PlaybackStatusCheck | undefined
  let startAt = resumeFrom?.position ?? startPositionSeconds
  let resume: ResumePoint | undefined = resumeFrom && { ...resumeFrom }
  let lastReportedPosition = startAt ?? 0
  let lastKnownPosition: number | null = null
  let unacknowledgedEndPosition: number | null = null
  // Where the attached stream's media really ends, when its copy ran short of the advertised end.
  let realEnd: number | null = null
  let endedAtRealEnd = false
  // Where the playhead stopped when playback ended; a viewer's seek after the end moves it away.
  let endedPosition = 0
  // hls.js stops loading after a fatal error, which a stream with a known real end may survive.
  let sourceStopped = false
  let firstFrameShown = false
  // A browser can finish a seek before it fires the seek's queued waiting event, so a seek that
  // finished without the media to play on waits until playback resumes.
  let seekUnresumed = false
  // The position of the seek whose seeking event has fired and whose seeked event has not. The
  // element keeps such a seek running for as long as no media comes, so its stall limit fails it
  // like any stall. hls.js and the browser's own controls seek without the player, so for their
  // seeks the element's events are the only signal.
  let seekUnderwayTo: number | null = null
  // hls.js stops loading after a fatal error, so a failure that ended playback leaves the stream
  // to attach again before it can play.
  let attachedPlayback: PlaybackSessionFieldsFragment | null = null
  let stall: Stall | undefined
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
        restartStoppedSource()
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
        clearStallLimit()
        if (endedAtRealEnd) return
        if (resume) resume.playing = false
        lastKnownPosition = element.currentTime
        report('PAUSED', element.currentTime)
      },
      // A seek starts a new wait for media, which a browser need not announce with a waiting event
      // when the seek leaves a stall.
      onSeeking: (element) => {
        clearStallLimit()
        if (!element.paused) startStallLimit()
        seekUnresumed = true
        seekUnderwayTo = element.currentTime
      },
      onSeeked: (element) => {
        seekUnderwayTo = null
        if (element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return
        clearStallLimit()
        seekUnresumed = false
      },
      onPlaying: () => {
        clearStallLimit()
        seekUnresumed = false
      },
      // A seek before the real end waits for its own data, which can still come.
      onWaiting: (element) => {
        // The browser queues the event, so the media can have come by the time it fires.
        if (element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return
        if (realEnd === null) void askForRealEnd()
        if (!seekingBeforeRealEnd() && tryEndAtRealEnd()) return
        startStallLimit()
        if (sourceStopped) restartStoppedSource()
      },
      // An element that also ends where playback ended at the real end has nothing new to report.
      onEnded: (element) => {
        if (!endedAtRealEnd) reportEnd(element.currentTime)
      },
    })
  }

  function reportEnd(endedAt: number) {
    lastKnownPosition = endedAt
    unacknowledgedEndPosition = endedAt
    // A replay can move the playhead while an earlier report holds the queue.
    reportStopped(() => endedAt)
  }

  // The last segment of a short copy can hold less media than its advertised length, so the
  // element may stall up to one segment before the real end. Before its first frame, the element
  // waits for the media it starts with, which can still come.
  function withinASegmentOfRealEnd(): boolean {
    if (realEnd === null) return false
    if (video.currentTime >= realEnd) return true
    const segmentSeconds = source?.segmentSeconds() ?? DEFAULT_SEGMENT_SECONDS
    return firstFrameShown && video.currentTime >= realEnd - segmentSeconds
  }

  // Ends playback as at the end of the media title. Callers end it only while it has not ended.
  function endAtRealEnd() {
    if (realEnd === null) {
      return
    }
    endedAtRealEnd = true
    // Playback that ended has started; only attaching the stream again starts it anew.
    startupDeadline.end()
    stopStatusCheck()
    video.pause()
    endedPosition = video.currentTime
    reportEnd(realEnd)
  }

  // Playback that ended at the real end attaches the stream again when the viewer plays on.
  function chooseDynamicRange(choice: DynamicRangeChoice) {
    if (choice === dynamicRange) return
    dynamicRange = choice
    if (!source?.followsVideoPreference || endedAtRealEnd) return
    resume = resumePoint()
    stopStatusCheck()
    detachSource()
    startupDeadline.end()
    startupDeadline = createStartupDeadline(expireStartup)
    adoptPlayback(attachedPlayback)
  }

  function restartStoppedSource() {
    resume = { position: video.currentTime, playing: !video.paused }
    detachSource()
    startupDeadline.end()
    startupDeadline = createStartupDeadline(expireStartup)
    adoptPlayback(attachedPlayback)
  }

  // A seek's wait for media before the real end is no stall, but media past it never comes.
  function seekingBeforeRealEnd(): boolean {
    return (video.seeking || seekUnresumed) && realEnd !== null && video.currentTime < realEnd
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

  // The server holds a segment request past a short copy's real end instead of refusing it, so a
  // stall asks once whether the stream still attached when the answer comes ends there.
  async function askForRealEnd() {
    if (!playbackSessionId) return
    try {
      const playback = await readPlaybackSession(playbackSessionId, statusCancellation.signal)
      const seconds = mediaEndOf(attachedStreamIn(playback))
      if (!cancelled && typeof seconds === 'number') learnRealEnd(seconds)
    } catch {
      // A stall that learns nothing waits as before; the stream's own errors still surface.
    }
  }

  // The server named the real end only after the playhead may have reached it and stalled there.
  function learnRealEnd(seconds: number) {
    realEnd = seconds
    if (seekingBeforeRealEnd()) {
      return
    }
    if (video.currentTime >= seconds || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      tryEndAtRealEnd()
    }
  }
  let timeline = trackTimeline()

  // Only the end of the stall, a pause, a seek or a detached stream stops the limit; a later
  // waiting event of the same stall leaves it running, and a seek starts it again.
  function startStallLimit() {
    if (stall || !playbackSessionId) return
    const id = playbackSessionId
    const started: Stall = {
      controller: new AbortController(),
      timer: setTimeout(() => void endStall(started, id), STALL_LIMIT_MS),
    }
    stall = started
  }

  // The element fires the seeking event from a queued task, which then starts the seek's own
  // limit. An earlier stall's status read can answer before that task runs, so a running limit
  // starts again here, as the viewer seeks. A browser that ignores the seek fires no event, and
  // the stall keeps a limit.
  function seek(seconds: number) {
    video.currentTime = seconds
    if (!stall) return
    clearStallLimit()
    startStallLimit()
  }

  // Also abandons the status read of a stall that outlasted the limit, and forgets that it did
  // while a switch waits: the element played, paused or seeked since.
  function clearStallLimit() {
    const pending = switchPendingFor(sourceGeneration)
    if (pending) pending.stalled = false
    if (!stall) return
    clearTimeout(stall.timer)
    stall.controller.abort()
    stall = undefined
  }

  // A stall that outlasts the limit fails the stream, unless it stalled at a real end that the
  // playback status names now, or the status names another stream, which the status check then
  // attaches.
  async function endStall(ended: Stall, id: string) {
    const deadline = setTimeout(() => ended.controller.abort(), PLAYBACK_START_TIMEOUT_MS)
    const status = await readPlaybackSession(id, ended.controller.signal).then(
      (playback) => ({ read: true as const, playback }),
      () => ({ read: false as const }),
    )
    clearTimeout(deadline)
    if (stall !== ended) return
    stall = undefined
    if (!stallStillLasts()) return
    if (!status.read) {
      failStalledStream()
      return
    }
    const attachedStream = attachedStreamIn(status.playback)
    // Attaching the other stream detaches this one, which stops the next limit.
    if (!attachedStream) {
      startStallLimit()
      void reconcilePlaybackStatus({ generation: sourceGeneration, fatal: false })
      return
    }
    const seconds = mediaEndOf(attachedStream)
    if (typeof seconds === 'number') learnRealEnd(seconds)
    if (!endedAtRealEnd) failStalledStream()
  }

  // The media element can resume, pause or seek before it fires the event that stops the limit.
  // A seek that hls.js or the browser started, whose event has not fired yet, starts its own
  // limit when the event fires.
  function stallStillLasts(): boolean {
    return !(
      video.paused ||
      (video.seeking && video.currentTime !== seekUnderwayTo) ||
      video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    )
  }

  function failStalledStream() {
    const pending = switchPendingFor(sourceGeneration)
    if (pending) {
      pending.stalled = true
      return
    }
    stopStatusCheck()
    detachSource()
    showFailure(FAILED_ATTEMPT_FALLBACK_MESSAGE)
  }

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
      declaration = capabilities
      // The server requires a video entry, so a browser that decodes no video cannot play here.
      if (capabilities.video.length === 0) {
        showFailure(PLAYBACK_FAILURE_MESSAGE)
        return
      }
      // The UI deadline must not discard a late session ID that still needs destruction.
      let result = await createPlaybackSession({
        capabilities,
        startPositionSeconds: startAt === 0 ? undefined : startAt,
      })
      // Watch progress belongs to the title, so a longer cut's progress can pass this file's end.
      if (!cancelled && refusedTheStartPosition(result.data?.createPlaybackSession)) {
        startFromTheBeginning()
        result = await createPlaybackSession({ capabilities })
      }
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

  function startFromTheBeginning() {
    startAt = undefined
    lastReportedPosition = 0
    if (resume) resume.position = 0
  }

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
    realEnd = mediaEndOf(attempt.streamSession) ?? (sameStream ? realEnd : null)
    endedAtRealEnd = false
    sourceStopped = false
    firstFrameShown = false
    const generation = sourceGeneration
    timeline.detach()
    timeline = trackTimeline()
    const qualities: QualityChoices = {
      offered: playback.offeredChoices,
      requested: playback.requestedChoice,
      playing: playback.playbackChoice,
      formatChange: playback.formatChange,
    }
    const { streamSession } = attempt
    // A source file holds no start position of its own, as a playlist's EXT-X-START does, so the
    // element seeks where the stream session says playback starts.
    if (streamSession.__typename === 'DirectPlayStreamSession') {
      startAt = streamSession.startPositionSeconds ?? undefined
    }
    const options: StreamSourceOptions = {
      startupDeadline,
      videoPreference: hlsVideoPreference(declaration, dynamicRange),
      onFirstFrame: () => {
        firstFrameShown = true
        onOutputShown(qualities)
      },
      onFormatFailure: (reason) => {
        void reportFormatFailure(reason, generation)
      },
      onStatusRequired: (fatal) => {
        // A stream that stops for good within one segment of the real end has ended there.
        if (fatal && tryEndAtRealEnd()) return
        void reconcilePlaybackStatus({ generation, fatal })
      },
      onFatal: () => {
        if (cancelled || generation !== sourceGeneration) return
        if (tryEndAtRealEnd()) return
        const pending = switchPendingFor(generation)
        if (pending) {
          pending.failed = true
          return
        }
        stopStatusCheck()
        detachSource()
        showFailure(PLAYBACK_FAILURE_MESSAGE)
      },
    }
    source =
      streamSession.__typename === 'DirectPlayStreamSession'
        ? attachSourceFile(video, streamSession, {
            ...options,
            selectsAudioTrack: declaration.selectsAudioTrackInDirectPlay,
            onChooseAudio: (position) => void switchAudioTrack(position, generation),
          })
        : attach(video, streamSession.streamUrl, options)
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
    // The server lets a failure wait for a switch rather than start a second HLS attempt.
    const pending = switchPendingFor(generation)
    if (pending) {
      pending.formatFailure ??= reason
      return
    }
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

  // A player that cannot switch the file's audio track moves to HLS for the chosen one. Direct play
  // goes on until the server has started that stream session, and goes on for good when it refuses.
  // The server ends direct play as it answers, so a failure of the file meanwhile waits for the
  // answer, and belongs to the source it came from.
  async function switchAudioTrack(audioTrackPosition: number, generation: number) {
    if (
      cancelled ||
      generation !== sourceGeneration ||
      reportingFormat ||
      switchPendingFor(generation) ||
      !playbackSessionId ||
      !sessionId
    )
      return
    const pending: PendingAudioTrackSwitch = {
      generation,
      formatFailure: null,
      failed: false,
      stalled: false,
    }
    pendingSwitch = pending
    const answer = await requestAudioTrackSwitch({
      playbackSessionId,
      streamSessionId: sessionId,
      audioTrackPosition,
    })
    if (pendingSwitch === pending) pendingSwitch = null
    if (cancelled || generation !== sourceGeneration) return
    switch (answer.kind) {
      case 'started': {
        beginHandover()
        const playback = await awaitReadyPlayback(answer.playback)
        if (!cancelled) adoptPlayback(playback)
        return
      }
      case 'refused':
        onNotice(answer.message)
        failAfterTheSwitch(pending)
        return
      case 'kept':
        failAfterTheSwitch(pending)
        return
      case 'lost':
        if (pending.formatFailure) {
          void reportFormatFailure(pending.formatFailure, generation)
          return
        }
        await recoverLostSwitch(pending)
    }
  }

  // Only the playback status can say whether the server switched. The server may end direct play
  // while the status is on its way, so the file's failures keep waiting until the status answers.
  // A stall can still end meanwhile, so only a failure of the file makes the check fatal.
  async function recoverLostSwitch(pending: PendingAudioTrackSwitch) {
    pendingSwitch = pending
    await reconcilePlaybackStatus({ generation: pending.generation, fatal: pending.failed })
    if (pendingSwitch !== pending) return
    pendingSwitch = null
    if (cancelled || pending.generation !== sourceGeneration) return
    failAfterTheSwitch(pending)
  }

  async function requestAudioTrackSwitch(
    input: SwitchPlaybackAudioTrackInput,
  ): Promise<AudioTrackSwitchAnswer> {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), PLAYBACK_START_TIMEOUT_MS)
    try {
      const result = await client.mutate({
        mutation: SwitchPlaybackAudioTrackDocument,
        variables: { input },
        fetchPolicy: 'no-cache',
        context: {
          fetchOptions: { signal: AbortSignal.any([statusCancellation.signal, deadline.signal]) },
        },
      })
      const payload = result.data?.switchPlaybackAudioTrack
      const refusal = payload?.userErrors[0]
      if (refusal) return { kind: 'refused', message: userErrorMessage(refusal) }
      // The server keeps a session that already plays the chosen track, or that moved on.
      if (!payload?.playbackSession || attachedStreamIn(payload.playbackSession)) {
        return { kind: 'kept' }
      }
      return { kind: 'started', playback: payload.playbackSession }
    } catch {
      return { kind: 'lost' }
    } finally {
      clearTimeout(timer)
    }
  }

  function switchPendingFor(generation: number): PendingAudioTrackSwitch | undefined {
    return pendingSwitch?.generation === generation ? pendingSwitch : undefined
  }

  // Direct play goes on after a switch the server did not make, unless the file failed meanwhile,
  // or a stall that outlasted its limit still lasts.
  function failAfterTheSwitch(pending: PendingAudioTrackSwitch) {
    if (pending.failed || (pending.stalled && stallStillLasts())) {
      stopStatusCheck()
      failSource()
      return
    }
    if (pending.formatFailure) void reportFormatFailure(pending.formatFailure, pending.generation)
  }

  function currentResumePoint(): ResumePoint {
    const playing = !playRequested || !video.paused
    // No playback session starts at the end of the media, and a short copy holds nothing past its
    // real end. As the element does after its own end, playing where playback ended starts from
    // the top.
    if (
      video.ended ||
      (realEnd !== null && video.currentTime >= realEnd) ||
      (endedAtRealEnd && video.currentTime === endedPosition)
    ) {
      return { position: 0, playing }
    }
    return {
      position:
        video.readyState >= HTMLMediaElement.HAVE_METADATA
          ? video.currentTime
          : (startAt ?? video.currentTime),
      playing,
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

  // A caller that joins a running check waits for that check to settle. A check begun for a stream
  // that has since been detached discards what it reads, so a new check replaces it.
  function reconcilePlaybackStatus({
    generation,
    fatal,
  }: {
    generation: number
    fatal: boolean
  }): Promise<void> {
    if (
      cancelled ||
      generation !== sourceGeneration ||
      reportingFormat ||
      !playbackSessionId ||
      endedAtRealEnd
    )
      return Promise.resolve()
    if (statusCheck?.generation === generation) {
      statusCheck.fatal ||= fatal
      return statusCheck.settled
    }
    stopStatusCheck()
    const check: PlaybackStatusCheck = {
      controller: new AbortController(),
      generation,
      fatal,
      settled: Promise.resolve(),
    }
    statusCheck = check
    check.settled = runStatusCheck(check, playbackSessionId)
    return check.settled
  }

  async function runStatusCheck(check: PlaybackStatusCheck, id: string) {
    const current = () =>
      !cancelled && statusCheck === check && check.generation === sourceGeneration
    const deadline = setTimeout(() => check.controller.abort(), PLAYBACK_START_TIMEOUT_MS)
    try {
      await pollForReplacement({ check, current, id })
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
      const playback = await readPlaybackSession(id, check.controller.signal)
      if (!current()) return
      const attachedStream = attachedStreamIn(playback)
      const realEndOfStream = mediaEndOf(attachedStream)
      // The segments past a short copy's real end never come, and nothing replaces the stream.
      if (typeof realEndOfStream === 'number') {
        playOnToTheRealEnd(realEndOfStream, check.fatal)
        return
      }
      if (attachedStream) {
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

  // The stream this player has attached, when the playback session still names it.
  function attachedStreamIn(playback: PlaybackSessionFieldsFragment | null | undefined) {
    const attempt = playback?.currentFormatAttempt
    if (attempt?.__typename !== 'ReadyPlaybackFormatAttempt') return undefined
    return attempt.streamSession.id === sessionId ? attempt.streamSession : undefined
  }

  function playOnToTheRealEnd(seconds: number, sourceFailed: boolean) {
    learnRealEnd(seconds)
    if (sourceFailed && !endedAtRealEnd) keepPlayingFromAStoppedSource()
  }

  // Buffered media plays on to the real end; a stall short of it needs the stream attached again.
  // A stream that stops before its first frame has played nothing, so attaching it again would
  // only repeat the failure.
  function keepPlayingFromAStoppedSource() {
    if (!firstFrameShown) {
      failSource()
      return
    }
    sourceStopped = true
    if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) restartStoppedSource()
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
      const next = await readPlaybackSession(initial.id, signal)
      if (!current()) {
        return undefined
      }
      playback = next
      if (playback?.currentFormatAttempt.__typename === 'PendingPlaybackFormatAttempt') {
        await waitForPlaybackStatus(signal)
      }
    }
    return playback
  }

  async function readPlaybackSession(id: string, signal: AbortSignal) {
    const result = await client.query({
      query: PlaybackSessionDocument,
      variables: { id },
      fetchPolicy: 'no-cache',
      // Apollo would otherwise join an identical read already on its way, which this signal cannot
      // abort, so a read that never answers would hold every later deadline open.
      context: { fetchOptions: { signal }, queryDeduplication: false },
    })
    return result.data?.playbackSession
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
    clearStallLimit()
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
    seek,
    leavePage,
    chooseDynamicRange,
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
    onSeeking: TimelineHandler
    onSeeked: TimelineHandler
    onPlaying: TimelineHandler
    onWaiting: TimelineHandler
    onEnded: TimelineHandler
  },
): { detach: () => void } {
  const onLoadedMetadata = () => handlers.onLoadedMetadata(video)
  const onTimeUpdate = () => handlers.onTimeUpdate(video)
  const onPlay = () => handlers.onPlay(video)
  const onPause = () => handlers.onPause(video)
  const onSeeking = () => handlers.onSeeking(video)
  const onSeeked = () => handlers.onSeeked(video)
  const onPlaying = () => handlers.onPlaying(video)
  const onWaiting = () => handlers.onWaiting(video)
  const onEnded = () => handlers.onEnded(video)
  video.addEventListener('loadedmetadata', onLoadedMetadata)
  video.addEventListener('timeupdate', onTimeUpdate)
  video.addEventListener('play', onPlay)
  video.addEventListener('pause', onPause)
  video.addEventListener('seeking', onSeeking)
  video.addEventListener('seeked', onSeeked)
  video.addEventListener('playing', onPlaying)
  video.addEventListener('waiting', onWaiting)
  video.addEventListener('ended', onEnded)
  return {
    detach: () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('playing', onPlaying)
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

function refusedTheStartPosition(payload: PlaybackSessionPayload | undefined): boolean {
  return (
    payload?.userErrors.some((refusal) => refusal.__typename === 'StartPositionOutOfRangeError') ??
    false
  )
}

type StreamSession = Extract<
  PlaybackSessionFieldsFragment['currentFormatAttempt'],
  { __typename: 'ReadyPlaybackFormatAttempt' }
>['streamSession']

// Only an HLS copy can run short of its advertised end; a source file ends where its media ends.
function mediaEndOf(stream: StreamSession | undefined): number | null | undefined {
  if (stream?.__typename !== 'HlsStreamSession') return undefined
  return stream.mediaEndSeconds
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
  /** Whether attaching the stream again with another video preference can change its range. */
  followsVideoPreference: boolean
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
  videoPreference: VideoSelectionOption
}

// The stream URL carries the playback ?t= token; relative segment requests inherit it.
function attach(video: HTMLVideoElement, url: string, options: StreamSourceOptions): StreamSource {
  if (!Hls.isSupported()) {
    return attachNative(video, url, options)
  }
  const hls: Hls = new Hls(hlsPlaybackConfig(() => hls, options.videoPreference))
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.response?.code === 503) {
      options.onStatusRequired(data.fatal)
      return
    }
    // The server holds a segment request past a short copy's real end, so only the playback
    // status can tell a request that never ends from a failure.
    if (data.fatal && data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT) {
      options.onStatusRequired(true)
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
    followsVideoPreference: true,
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

const SOURCE_FILE_CHECK_TIMEOUT_MS = 10_000

// MediaError's codes, which not every environment defines as constants.
const MEDIA_ERR_DECODE = 3
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4

// Direct play hands the source file to the element, which reads it with byte-range requests. The
// element has parsed the file's header by its metadata, so startup ends there, even when the
// browser withholds the first frame until the viewer presses play.
interface SourceFile {
  streamUrl: string
  /** The audio track the stream decision names among the file's audio tracks; null for none. */
  audioTrackPosition: number | null
  /** The file's audio tracks as the server lists them, in stream order. */
  audioTracks: readonly ListedAudioTrack[]
}

interface SourceFileOptions extends StreamSourceOptions {
  /** Whether the element lists the file's audio tracks and switches between them itself. */
  selectsAudioTrack: boolean
  /** Moves playback to another audio track of the file, for an element that cannot switch. */
  onChooseAudio: (position: number) => void
}

function attachSourceFile(
  video: HTMLVideoElement,
  { streamUrl: url, audioTrackPosition, audioTracks }: SourceFile,
  options: SourceFileOptions,
): StreamSource {
  const { startupDeadline, onFirstFrame, selectsAudioTrack, onChooseAudio } = options
  const detached = new AbortController()
  const elementTracks = nativeTrackSource(video)
  const onVideoError = () => {
    void handleSourceFileError({ video, url, options, signal: detached.signal })
  }
  // The element starts the file's default audio track, which can differ from the named one. It
  // lists the file's tracks in the file's order, but only by the first frame is the list complete.
  const selectNamedAudioTrack = () => {
    if (audioTrackPosition === null) return
    if (elementTracks.read().audio.options.length <= audioTrackPosition) return
    elementTracks.selectAudio(audioTrackPosition)
  }
  // A track the viewer picks before the first frame stands. An element that cannot switch plays
  // the track the server direct-plays the file for, so only the server's list names the others.
  const tracks: TrackSource = selectsAudioTrack
    ? {
        ...elementTracks,
        selectAudio: (id) => {
          video.removeEventListener('loadeddata', selectNamedAudioTrack)
          elementTracks.selectAudio(id)
        },
      }
    : listedAudioTrackSource(elementTracks, {
        audioTracks,
        playing: audioTrackPosition,
        onChooseAudio,
      })
  video.addEventListener('error', onVideoError)
  video.addEventListener('loadedmetadata', startupDeadline.end)
  if (selectsAudioTrack) {
    video.addEventListener('loadeddata', selectNamedAudioTrack, { once: true })
  }
  video.addEventListener('loadeddata', onFirstFrame, { once: true })
  video.src = url
  return {
    detach: () => {
      detached.abort()
      video.removeEventListener('error', onVideoError)
      video.removeEventListener('loadedmetadata', startupDeadline.end)
      video.removeEventListener('loadeddata', selectNamedAudioTrack)
      video.removeEventListener('loadeddata', onFirstFrame)
      releaseElementSource(video)
    },
    // The element plays the file itself, so no video preference picks its range.
    followsVideoPreference: false,
    tracks,
    segmentSeconds: () => undefined,
  }
}

// A file the browser cannot decode, or whose format it cannot open, is a format error, after which
// the server's next format attempt is HLS at original quality. An aborted or failed fetch says
// nothing about the format.
async function handleSourceFileError({
  video,
  url,
  options,
  signal,
}: {
  video: HTMLVideoElement
  url: string
  options: StreamSourceOptions
  signal: AbortSignal
}) {
  switch (video.error?.code) {
    case MEDIA_ERR_DECODE:
      options.onFormatFailure('DECODE_ERROR')
      return
    case MEDIA_ERR_SRC_NOT_SUPPORTED:
      if (await isSourceFileDelivered(url, signal)) {
        options.onFormatFailure('UNSUPPORTED_FORMAT')
        return
      }
      options.onFatal()
      return
    default:
      options.onFatal()
  }
}

// The element also calls a source unsupported when the server refused it, as with a 404 for a file
// that has gone or a 503, and a refused file says nothing about its format. Only a file whose first
// byte arrives is one the element could not open. The response headers prove nothing: its body can
// still stall, fail or end empty, so the deadline covers the first byte itself.
async function isSourceFileDelivered(url: string, signal: AbortSignal): Promise<boolean> {
  const check = new AbortController()
  const deadline = setTimeout(() => check.abort(), SOURCE_FILE_CHECK_TIMEOUT_MS)
  try {
    const stopped = AbortSignal.any([signal, check.signal])
    const response = await fetch(new URL(url, window.location.href), {
      headers: { Range: 'bytes=0-0' },
      credentials: 'same-origin',
      signal: stopped,
    })
    return response.ok && (await hasFirstByte(response, stopped))
  } catch {
    return false
  } finally {
    clearTimeout(deadline)
  }
}

// Not every fetch ties an aborted request's body to its signal, so the signal cancels the read.
async function hasFirstByte(response: Response, stopped: AbortSignal): Promise<boolean> {
  const reader = response.body?.getReader()
  if (!reader) {
    return false
  }
  const cancel = () => void reader.cancel().catch(() => undefined)
  stopped.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        return false
      }
      if (value.byteLength > 0) {
        return true
      }
    }
  } finally {
    stopped.removeEventListener('abort', cancel)
    cancel()
  }
}

// The same reset hls.js performs on detach: the element stops fetching the stream.
function releaseElementSource(video: HTMLVideoElement) {
  video.removeAttribute('src')
  video.load()
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
      releaseElementSource(video)
    },
    followsVideoPreference: false,
    tracks: nativeTrackSource(video),
    segmentSeconds: () => undefined,
  }
}
