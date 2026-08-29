import { useApolloClient, useMutation } from '@apollo/client/react'
import { Alert, AspectRatio, Stack } from '@mantine/core'
import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import {
  CreateStreamSessionDocument,
  ReportStreamSessionTimelineDocument,
  type ReportStreamSessionTimelineMutationVariables,
} from '../graphql/generated/graphql'

// Progress is only worth a round trip once the playhead has moved this far since the last report.
const TIMELINE_REPORT_INTERVAL_SECONDS = 10

type PlaybackState = ReportStreamSessionTimelineMutationVariables['state']

export function Player({
  mediaFileId,
  startPositionSeconds,
}: {
  mediaFileId: string
  startPositionSeconds?: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [createStreamSession] = useMutation(CreateStreamSessionDocument)
  const client = useApolloClient()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return undefined
    }
    setFailed(false)

    let hls: Hls | null = null
    let cancelled = false
    let sessionId: string | null = null
    let lastReportedPosition = startPositionSeconds ?? 0
    let lastKnownPosition: number | null = null

    function report(state: PlaybackState, positionSeconds: number) {
      if (!sessionId) {
        return
      }
      client
        .mutate({
          mutation: ReportStreamSessionTimelineDocument,
          variables: { sessionId, positionSeconds: Math.floor(positionSeconds), state },
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
    })

    createStreamSession({ variables: { mediaFileId } })
      .then((result) => {
        const session = result.data?.createStreamSession
        if (cancelled || !session) {
          return
        }
        sessionId = session.id
        hls = attach(video, session.streamUrl, () => {
          hls = null
          setFailed(true)
        })
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
      timeline.detach()
      if (lastKnownPosition !== null) {
        report('STOPPED', lastKnownPosition)
      }
      hls?.destroy()
    }
  }, [mediaFileId, startPositionSeconds, createStreamSession, client])

  return (
    <Stack maw={960}>
      {failed && (
        <Alert color="red" role="alert">
          Playback couldn't start. Try again.
        </Alert>
      )}
      <AspectRatio ratio={16 / 9}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} controls style={{ width: '100%' }} />
      </AspectRatio>
    </Stack>
  )
}

type TimelineHandler = (video: HTMLVideoElement) => void

function attachTimeline(
  video: HTMLVideoElement,
  handlers: { onLoadedMetadata: TimelineHandler; onTimeUpdate: TimelineHandler; onPause: TimelineHandler },
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

// A missed progress report costs nothing the next one doesn't restore, and playback must never
// surface it.
function ignoreTimelineReportFailure() {}

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
