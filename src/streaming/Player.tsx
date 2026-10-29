import { useApolloClient, useMutation } from '@apollo/client/react'
import { Alert, Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { CreatePlaybackSessionDocument } from '../graphql/generated/graphql'
import { DetailBackButton } from '../media/DetailBack'
import focusStyles from '../styles/focus.module.css'
import { BufferingRing } from './BufferingRing'
import { browserPlaybackPlatform, declarePlaybackCapabilities } from './playbackCapabilities'
import styles from './Player.module.css'
import {
  PlayerControls,
  type PlayerTitle,
  type TrackPickerKind,
  pickerOffersChoice,
} from './PlayerControls'
import { startPlayerPlayback, type SourcePhase } from './playerPlayback'
import { useIdle } from './useIdle'
import { useStreamTracks } from './useStreamTracks'
import { useVideoState } from './useVideoState'

const STARTING: SourcePhase = { at: 'starting' }

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
  const [createPlaybackSession] = useMutation(CreatePlaybackSessionDocument, {
    fetchPolicy: 'no-cache',
  })
  const client = useApolloClient()
  const [sourcePhase, setSourcePhase] = useState(STARTING)
  const [attempt, setAttempt] = useState(0)
  const [picker, setPicker] = useState<TrackPickerKind | null>(null)
  const tracks = sourcePhase.at === 'attached' ? sourcePhase.tracks : null
  const streamTracks = useStreamTracks(tracks)
  const openPicker = picker !== null && pickerOffersChoice(picker, streamTracks) ? picker : null
  // A picker that loses its choices, or its stream with them, closes rather than reopen later.
  if (picker !== openPicker) {
    setPicker(null)
  }
  const videoState = useVideoState(videoRef)
  const controlsHeld = videoState.paused || sourcePhase.at === 'failed' || openPicker !== null
  const idle = useIdle(controlsHeld, [controlsRef, backRef])

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return undefined
    }
    setSourcePhase(STARTING)

    return startPlayerPlayback({
      video,
      client,
      createPlaybackSession: async () => {
        const capabilities = await declarePlaybackCapabilities(browserPlaybackPlatform(video))
        return createPlaybackSession({ variables: { input: { mediaFileId, capabilities } } })
      },
      startPositionSeconds,
      onSourcePhase: setSourcePhase,
    })
  }, [mediaFileId, startPositionSeconds, createPlaybackSession, client, attempt])

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
        onOpenPicker={setPicker}
        title={title}
      />
    </section>
  )
}
