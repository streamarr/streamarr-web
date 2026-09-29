import type { ApolloClient, ObservableQuery } from '@apollo/client'
import { useApolloClient, useMutation } from '@apollo/client/react'
import { Alert, Button } from '@mantine/core'
import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import {
  CreateStreamSessionDocument,
  type CreateStreamSessionMutation,
  DestroyStreamSessionDocument,
  ReportStreamSessionTimelineDocument,
  type ReportStreamSessionTimelineMutationVariables,
} from '../graphql/generated/graphql'
import { userErrorMessage } from '../graphql/userErrors'
import { DetailBackButton } from '../media/DetailBack'
import { invalidateWatchedState } from '../media/watchedState'
import focusStyles from '../styles/focus.module.css'
import { BufferingRing } from './BufferingRing'
import styles from './Player.module.css'
import { PlayerControls, type PlayerTitle, type TrackPickerKind } from './PlayerControls'
import { hlsTrackSource, nativeTrackSource, type TrackSource } from './trackSources'
import { useIdle } from './useIdle'
import { useVideoState } from './useVideoState'

// Progress is only worth a round trip once the playhead has moved this far since the last report.
const TIMELINE_REPORT_INTERVAL_SECONDS = 10
const TIMELINE_CLEANUP_TIMEOUT_MS = 10_000
const PLAYBACK_START_TIMEOUT_MS = 30_000

const PLAYBACK_FAILURE_MESSAGE = "Playback couldn't start. Try again."

type PlaybackState = ReportStreamSessionTimelineMutationVariables['state']
type StreamSessionPayload = CreateStreamSessionMutation['createStreamSession']

type SourcePhase =
  { at: 'starting' } | { at: 'attached'; tracks: TrackSource } | { at: 'failed'; message: string }

const STARTING: SourcePhase = { at: 'starting' }

// Held against the stream whose tracks it lists, so a picker never outlives its stream.
interface OpenPicker {
  tracks: TrackSource
  kind: TrackPickerKind
}

const pendingCleanups = new WeakMap<ApolloClient, () => Promise<void>>()

export function Player({
  mediaFileId,
  startPositionSeconds,
  title,
}: Readonly<{
  mediaFileId: string
  startPositionSeconds?: number
  title?: PlayerTitle
}>) {
  const playerRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLDivElement>(null)
  const [createStreamSession] = useMutation(CreateStreamSessionDocument)
  const client = useApolloClient()
  const [sourcePhase, setSourcePhase] = useState(STARTING)
  const [attempt, setAttempt] = useState(0)
  const [picker, setPicker] = useState<OpenPicker | null>(null)
  const tracks = sourcePhase.at === 'attached' ? sourcePhase.tracks : null
  const openPicker = picker?.tracks === tracks ? picker.kind : null
  const videoState = useVideoState(videoRef)
  const controlsHeld = videoState.paused || sourcePhase.at === 'failed' || openPicker !== null
  const idle = useIdle(controlsHeld, [controlsRef, backRef])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return undefined
    }
    setSourcePhase(STARTING)

    let source: StreamSource | null = null
    let cancelled = false
    let sessionId: string | null = null
    let lastReportedPosition = startPositionSeconds ?? 0
    let lastKnownPosition: number | null = null
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
      if (!sessionId) {
        return
      }
      const variables = { sessionId, positionSeconds: Math.floor(positionSeconds), state }
      // The server accepts arrival order, including reports that precede the final STOPPED.
      timelineReports = timelineReports
        .then(async () => {
          if (reportCancellation.signal.aborted) {
            return
          }
          await client.mutate({
            mutation: ReportStreamSessionTimelineDocument,
            variables,
            context: { fetchOptions: { signal: reportCancellation.signal } },
            update: (cache, { data }) => {
              if (data?.reportStreamSessionTimeline) invalidateWatchedState(cache)
            },
            onQueryUpdated: refetchWatchedQuery,
          })
        })
        .catch(ignoreTimelineReportFailure)
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
        if (
          Math.abs(element.currentTime - lastReportedPosition) < TIMELINE_REPORT_INTERVAL_SECONDS
        ) {
          return
        }
        lastReportedPosition = element.currentTime
        report('PLAYING', element.currentTime)
      },
      onPause: (element) => {
        lastKnownPosition = element.currentTime
        report('PAUSED', element.currentTime)
      },
    })

    const startupDeadline = createStartupDeadline(() => {
      cancelled = true
      detachSource()
      setSourcePhase({ at: 'failed', message: 'Playback is taking too long to start. Try again.' })
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
        const result = await createStreamSession({ variables: { input: { mediaFileId } } })
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
        setSourcePhase({ at: 'attached', tracks: source.tracks })
      })
      .catch(() => {
        if (!cancelled) {
          showFailure(PLAYBACK_FAILURE_MESSAGE)
        }
      })

    function showFailure(message: string) {
      startupDeadline.end()
      setSourcePhase({ at: 'failed', message })
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
      if (lastKnownPosition !== null) {
        report('STOPPED', lastKnownPosition)
      }
      detachSource()
      requestCleanup()
    }
  }, [mediaFileId, startPositionSeconds, createStreamSession, client, attempt])

  return (
    <section
      ref={playerRef}
      aria-label="Player"
      className={`${styles.player} ${focusStyles.focusRing}`}
      data-idle={idle || undefined}
    >
      <video ref={videoRef} className={styles.video} playsInline />
      {videoState.buffering && <BufferingRing />}
      {sourcePhase.at === 'failed' && (
        <Alert className={styles.failure} color="red" role="alert">
          {sourcePhase.message}
          <Button display="block" mt="sm" onClick={() => setAttempt((value) => value + 1)}>
            Retry playback
          </Button>
        </Alert>
      )}
      <div ref={backRef} className={`${styles.back} ${styles.chrome}`}>
        <DetailBackButton />
      </div>
      <PlayerControls
        ref={controlsRef}
        className={styles.chrome}
        playerRef={playerRef}
        videoRef={videoRef}
        videoState={videoState}
        tracks={tracks}
        openPicker={openPicker}
        onOpenPicker={(kind) => setPicker(kind && tracks && { tracks, kind })}
        title={title}
      />
    </section>
  )
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
  },
): { detach: () => void } {
  const onLoadedMetadata = () => handlers.onLoadedMetadata(video)
  const onTimeUpdate = () => handlers.onTimeUpdate(video)
  const onPlay = () => handlers.onPlay(video)
  const onPause = () => handlers.onPause(video)
  video.addEventListener('loadedmetadata', onLoadedMetadata)
  video.addEventListener('timeupdate', onTimeUpdate)
  video.addEventListener('play', onPlay)
  video.addEventListener('pause', onPause)
  return {
    detach: () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
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
