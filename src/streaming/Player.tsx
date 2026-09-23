import { useApolloClient, useMutation } from '@apollo/client/react'
import { Alert, AspectRatio, Stack } from '@mantine/core'
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
import { invalidateWatchedState } from '../media/watchedState'

// Progress is only worth a round trip once the playhead has moved this far since the last report.
const TIMELINE_REPORT_INTERVAL_SECONDS = 10

const PLAYBACK_FAILURE_MESSAGE = "Playback couldn't start. Try again."

type PlaybackState = ReportStreamSessionTimelineMutationVariables['state']
type StreamSessionPayload = CreateStreamSessionMutation['createStreamSession']

export function Player({
  mediaFileId,
  startPositionSeconds,
}: Readonly<{
  mediaFileId: string
  startPositionSeconds?: number
}>) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [createStreamSession] = useMutation(CreateStreamSessionDocument)
  const client = useApolloClient()
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return undefined
    }
    setFailure(null)

    let hls: Hls | null = null
    let cancelled = false
    let sessionId: string | null = null
    let lastReportedPosition = startPositionSeconds ?? 0
    let lastKnownPosition: number | null = null
    let timelineReports = Promise.resolve()

    async function destroySession(id: string) {
      await client
        .mutate({
          mutation: DestroyStreamSessionDocument,
          variables: { sessionId: id },
        })
        .catch(() => {
          // The server's idle reaper owns cleanup if the connection has already gone away.
        })
    }

    function report(state: PlaybackState, positionSeconds: number) {
      if (!sessionId) {
        return
      }
      const variables = { sessionId, positionSeconds: Math.floor(positionSeconds), state }
      // The server accepts arrival order, including reports that precede the final STOPPED.
      timelineReports = timelineReports
        .then(async () => {
          await client.mutate({
            mutation: ReportStreamSessionTimelineDocument,
            variables,
            update: (cache, { data }) => {
              if (data?.reportStreamSessionTimeline) invalidateWatchedState(cache)
            },
            onQueryUpdated: (query) => {
              // UI refreshes must not hold the report queue or session disposal open.
              void query.refetch().catch(() => undefined)
              return false
            },
          })
        })
        .catch(ignoreTimelineReportFailure)
    }

    const timeline = attachTimeline(video, {
      // Seeking before metadata is loaded is unreliable across browsers; the event is the safe point.
      onLoadedMetadata: (element) => {
        if (startPositionSeconds) {
          element.currentTime = startPositionSeconds
        }
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

    createStreamSession({ variables: { input: { mediaFileId } } })
      .then((result) => {
        const payload = result.data?.createStreamSession
        const session = payload?.session
        if (cancelled) {
          return session ? destroySession(session.id) : undefined
        }
        if (!session) {
          setFailure(refusalMessage(payload))
          return
        }
        sessionId = session.id
        hls = attach(video, session.streamUrl, () => {
          hls = null
          setFailure(PLAYBACK_FAILURE_MESSAGE)
        })
      })
      .catch(() => {
        if (!cancelled) {
          setFailure(PLAYBACK_FAILURE_MESSAGE)
        }
      })

    return () => {
      cancelled = true
      timeline.detach()
      if (lastKnownPosition !== null) {
        report('STOPPED', lastKnownPosition)
      }
      hls?.destroy()
      const closingSessionId = sessionId
      if (closingSessionId) {
        void timelineReports.then(() => destroySession(closingSessionId))
      }
    }
  }, [mediaFileId, startPositionSeconds, createStreamSession, client])

  return (
    <Stack maw={960}>
      {failure && (
        <Alert color="red" role="alert">
          {failure}
        </Alert>
      )}
      <AspectRatio ratio={16 / 9}>
        <video ref={videoRef} controls style={{ width: '100%' }} />
      </AspectRatio>
    </Stack>
  )
}

type TimelineHandler = (video: HTMLVideoElement) => void

function attachTimeline(
  video: HTMLVideoElement,
  handlers: {
    onLoadedMetadata: TimelineHandler
    onTimeUpdate: TimelineHandler
    onPause: TimelineHandler
  },
): { detach: () => void } {
  const onLoadedMetadata = () => handlers.onLoadedMetadata(video)
  const onTimeUpdate = () => handlers.onTimeUpdate(video)
  const onPause = () => handlers.onPause(video)
  video.addEventListener('loadedmetadata', onLoadedMetadata)
  video.addEventListener('timeupdate', onTimeUpdate)
  video.addEventListener('pause', onPause)
  return {
    detach: () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('pause', onPause)
    },
  }
}

function refusalMessage(payload: StreamSessionPayload | undefined): string {
  const refusal = payload?.userErrors[0]
  return refusal ? userErrorMessage(refusal) : PLAYBACK_FAILURE_MESSAGE
}

function ignoreTimelineReportFailure() {
  // A missed progress report costs nothing the next one doesn't restore, and playback must never
  // surface it.
}

// The stream URL carries the playback ?t= token; relative segment requests inherit it.
function attach(video: HTMLVideoElement, url: string, onFatal: () => void): Hls | null {
  if (!Hls.isSupported()) {
    video.src = url
    return null
  }
  const hls = new Hls()
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      return
    }
    // An expired ?t= token or a restarted server: the instance cannot recover.
    hls.destroy()
    onFatal()
  })
  hls.loadSource(url)
  hls.attachMedia(video)
  return hls
}
