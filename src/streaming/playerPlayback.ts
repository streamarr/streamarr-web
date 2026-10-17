import type { ApolloClient, ObservableQuery } from '@apollo/client'
import Hls from 'hls.js'
import {
  type CreateStreamSessionMutation,
  DestroyStreamSessionDocument,
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

const PLAYBACK_FAILURE_MESSAGE = "Playback couldn't start. Try again."

type PlaybackState = ReportStreamSessionTimelineMutationVariables['state']
type StreamSessionPayload = CreateStreamSessionMutation['createStreamSession']

export type SourcePhase =
  { at: 'starting' } | { at: 'attached'; tracks: TrackSource } | { at: 'failed'; message: string }

const pendingCleanups = new WeakMap<ApolloClient, () => Promise<void>>()

export function startPlayerPlayback({
  video,
  client,
  createStreamSession,
  startPositionSeconds,
  onSourcePhase,
}: {
  video: HTMLVideoElement
  client: ApolloClient
  createStreamSession: () => Promise<{ data?: CreateStreamSessionMutation | null }>
  startPositionSeconds?: number
  onSourcePhase: (phase: SourcePhase) => void
}): () => void {
  let source: StreamSource | null = null
  let cancelled = false
  let sessionId: string | null = null
  let lastReportedPosition = startPositionSeconds ?? 0
  let lastKnownPosition: number | null = null
  let unacknowledgedEndPosition: number | null = null
  let timelineReports = Promise.resolve()
  const reportCancellation = new AbortController()
  let previousCleanup = pendingCleanups.get(client)
  let cleanupInFlight: Promise<void> | undefined

  async function destroySession(id: string) {
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), PLAYBACK_START_TIMEOUT_MS)
    const result = await client
      .mutate({
        mutation: DestroyStreamSessionDocument,
        variables: { sessionId: id },
        context: { fetchOptions: { signal: controller.signal } },
      })
      .finally(() => clearTimeout(deadline))
    if (!result.data?.destroyStreamSession) {
      throw new Error('Stream session destruction was not acknowledged')
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
        if (reportCancellation.signal.aborted) {
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
  const timeline = attachTimeline(video, {
    // Seeking before metadata is loaded is unreliable across browsers; the event is the safe point.
    onLoadedMetadata: (element) => {
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
      playRequested = true
    },
    onTimeUpdate: (element) => {
      lastKnownPosition = element.currentTime
      if (Math.abs(element.currentTime - lastReportedPosition) < TIMELINE_REPORT_INTERVAL_SECONDS) {
        return
      }
      lastReportedPosition = element.currentTime
      report('PLAYING', element.currentTime)
    },
    onPause: (element) => {
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

  const startupDeadline = createStartupDeadline(() => {
    cancelled = true
    detachSource()
    onSourcePhase({ at: 'failed', message: 'Playback is taking too long to start. Try again.' })
    requestCleanup()
  })
  const startup = Promise.resolve()
    .then(async () => {
      await previousCleanup?.()
      previousCleanup = undefined
      if (cancelled) {
        return
      }
      // The UI deadline must not discard a late session ID that still needs destruction.
      const result = await createStreamSession()
      const payload = result.data?.createStreamSession
      const session = payload?.session
      sessionId = session?.id ?? null
      if (cancelled) {
        return
      }
      if (!session) {
        showFailure(refusalMessage(payload))
        return
      }
      source = attach(video, session.streamUrl, {
        startupDeadline,
        onFatal: () => {
          if (cancelled) {
            return
          }
          detachSource()
          showFailure(PLAYBACK_FAILURE_MESSAGE)
        },
      })
      onSourcePhase({ at: 'attached', tracks: source.tracks })
    })
    .catch(() => {
      if (!cancelled) {
        showFailure(PLAYBACK_FAILURE_MESSAGE)
      }
    })

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
    if (sessionId) {
      await destroySession(sessionId)
      sessionId = null
    }
    if (pendingCleanups.get(client) === releaseSession) {
      pendingCleanups.delete(client)
    }
  }

  function detachSource() {
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
    startupDeadline.end()
    reportStopped(() => unacknowledgedEndPosition)
    reportStopped(() => lastKnownPosition)
    detachSource()
    requestCleanup()
  }
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

function refusalMessage(payload: StreamSessionPayload | undefined): string {
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
  startupDeadline: StartupDeadline
}

// The stream URL carries the playback ?t= token; relative segment requests inherit it.
function attach(video: HTMLVideoElement, url: string, options: StreamSourceOptions): StreamSource {
  if (!Hls.isSupported()) {
    return attachNative(video, url, options)
  }
  const hls = new Hls()
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      return
    }
    // An expired ?t= token or a restarted server: the instance cannot recover.
    options.onFatal()
  })
  video.addEventListener('loadedmetadata', options.startupDeadline.end)
  hls.loadSource(url)
  hls.attachMedia(video)
  return {
    detach: () => {
      video.removeEventListener('loadedmetadata', options.startupDeadline.end)
      hls.destroy()
    },
    tracks: hlsTrackSource(hls),
  }
}

// Without MSE the element plays HLS itself and reports failure only through its error event.
function attachNative(
  video: HTMLVideoElement,
  url: string,
  { onFatal, startupDeadline }: StreamSourceOptions,
): StreamSource {
  // WebKit loads metadata from the playlists alone, so startup ends on the first frame. A browser
  // may withhold that frame until the viewer presses play, so a suspend while paused holds startup
  // until then. A playing element that suspends is still owed its first frame.
  const holdWhilePaused = () => {
    if (video.paused) {
      startupDeadline.hold()
    }
  }
  video.addEventListener('error', onFatal)
  video.addEventListener('loadeddata', startupDeadline.end)
  video.addEventListener('suspend', holdWhilePaused)
  video.addEventListener('play', startupDeadline.rearm)
  video.src = url
  return {
    detach: () => {
      video.removeEventListener('error', onFatal)
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
