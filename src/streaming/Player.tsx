import { useMutation } from '@apollo/client/react'
import { Alert, AspectRatio } from '@mantine/core'
import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import { CreateStreamSessionDocument } from '../graphql/generated/graphql'

export function Player({ mediaFileId }: { mediaFileId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [createStreamSession] = useMutation(CreateStreamSessionDocument)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let hls: Hls | null = null
    let cancelled = false

    createStreamSession({ variables: { mediaFileId } })
      .then((result) => {
        const url = result.data?.createStreamSession.streamUrl
        const video = videoRef.current
        if (cancelled || !url || !video) {
          return
        }
        // The stream URL carries the playback ?t= token; segment requests spawned from the
        // playlist are relative and inherit it. hls.js handles that natively.
        if (Hls.isSupported()) {
          hls = new Hls()
          hls.loadSource(url)
          hls.attachMedia(video)
        } else {
          // Native HLS (Safari): the token rides the src just the same.
          video.src = url
        }
      })
      .catch(() => setFailed(true))

    return () => {
      cancelled = true
      hls?.destroy()
    }
  }, [mediaFileId, createStreamSession])

  if (failed) {
    return (
      <Alert color="red" role="alert">
        Playback couldn't start. Try again.
      </Alert>
    )
  }

  return (
    <AspectRatio ratio={16 / 9} maw={960}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} controls style={{ width: '100%' }} />
    </AspectRatio>
  )
}
