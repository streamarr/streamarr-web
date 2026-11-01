import { useApolloClient, useMutation } from '@apollo/client/react'
import { Alert, Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { CreatePlaybackSessionDocument, type VideoQuality } from '../graphql/generated/graphql'
import { DetailBackButton } from '../media/DetailBack'
import focusStyles from '../styles/focus.module.css'
import { BufferingRing } from './BufferingRing'
import { declarePlaybackCapabilities, type PlaybackPlatform } from './playbackCapabilities'
import styles from './Player.module.css'
import {
  PlayerControls,
  type PickerKind,
  type PlayerTitle,
  pickerOffersChoice,
} from './PlayerControls'
import {
  type PlayerPlayback,
  type ResumePoint,
  startPlayerPlayback,
  type SourcePhase,
} from './playerPlayback'
import { useIdle } from './useIdle'
import { useStreamTracks } from './useStreamTracks'
import { useVideoState } from './useVideoState'

const STARTING: SourcePhase = { at: 'starting' }

// Each pick is a new object, so picking Original again after it changed to Auto starts afresh.
interface ChoiceRequest {
  mediaFileId: string
  quality: VideoQuality
  resumeFrom?: ResumePoint
}

function startingChoice(mediaFileId: string): ChoiceRequest {
  return { mediaFileId, quality: 'AUTO' }
}

export function Player({
  mediaFileId,
  startPositionSeconds,
  title,
  playbackPlatform,
}: Readonly<{
  mediaFileId: string
  startPositionSeconds?: number
  title?: PlayerTitle
  /** Binds the browser facts the capability declaration is built from to the playing element. */
  playbackPlatform: (video: HTMLVideoElement) => PlaybackPlatform
}>) {
  const playerRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLDivElement>(null)
  const playbackRef = useRef<PlayerPlayback>(null)
  const [createPlaybackSession] = useMutation(CreatePlaybackSessionDocument, {
    fetchPolicy: 'no-cache',
  })
  const client = useApolloClient()
  const [sourcePhase, setSourcePhase] = useState(STARTING)
  const [attempt, setAttempt] = useState(0)
  const [choice, setChoice] = useState(() => startingChoice(mediaFileId))
  // Another media title starts in Auto from its own start position.
  if (choice.mediaFileId !== mediaFileId) {
    setChoice(startingChoice(mediaFileId))
  }
  const [picker, setPicker] = useState<PickerKind | null>(null)
  const tracks = sourcePhase.at === 'attached' ? sourcePhase.tracks : null
  const qualities = sourcePhase.at === 'attached' ? sourcePhase.qualities : null
  const quality = {
    offered: qualities?.offered ?? [],
    selected: qualities?.playing ?? choice.quality,
  }
  const streamTracks = useStreamTracks(tracks)
  const openPicker =
    picker !== null && pickerOffersChoice(picker, { ...streamTracks, qualities: quality.offered })
      ? picker
      : null
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

    const playback = startPlayerPlayback({
      video,
      client,
      declareCapabilities: () => declarePlaybackCapabilities(playbackPlatform(video)),
      createPlaybackSession: (capabilities) =>
        createPlaybackSession({
          variables: {
            input: { mediaFileId, capabilities, options: { quality: choice.quality } },
          },
        }),
      startPositionSeconds,
      resumeFrom: choice.resumeFrom,
      onSourcePhase: setSourcePhase,
    })
    playbackRef.current = playback
    return playback.stop
  }, [
    mediaFileId,
    startPositionSeconds,
    createPlaybackSession,
    client,
    attempt,
    playbackPlatform,
    choice,
  ])

  function chooseQuality(picked: VideoQuality) {
    const playback = playbackRef.current
    if (!playback || picked === quality.selected) {
      return
    }
    setChoice({ mediaFileId, quality: picked, resumeFrom: playback.resumePoint() })
  }

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
        quality={quality}
        onChooseQuality={chooseQuality}
        openPicker={openPicker}
        onOpenPicker={setPicker}
        title={title}
      />
    </section>
  )
}
