import { useApolloClient, useMutation } from '@apollo/client/react'
import { Alert, Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import {
  CreatePlaybackSessionDocument,
  type Language,
  type VideoQuality,
} from '../graphql/generated/graphql'
import { languageOfTrack } from '../languages/languages'
import { DetailBackButton } from '../media/DetailBack'
import focusStyles from '../styles/focus.module.css'
import { BufferingRing } from './BufferingRing'
import { PlaybackNotice } from './PlaybackNotice'
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
import { useLanguageSwitchReport } from './useLanguageSwitchReport'
import { usePlaybackFallbacks } from './usePlaybackFallbacks'
import type { StreamTracks } from './trackSources'
import { useStreamTracks } from './useStreamTracks'
import type { PlayableMediaTitle } from './usePlayerTitle'
import { useVideoState } from './useVideoState'

const STARTING: SourcePhase = { at: 'starting' }

// Every pick and every Retry is a new object, so each starts a new playback session, even for the
// same quality: picking Original again after it changed to Auto starts it afresh.
interface ChoiceRequest {
  start: PlaybackStart
  quality: VideoQuality
  resumeFrom?: ResumePoint
}

// The audio language that plays from a start, which every later playback session of that start asks
// for: the server puts the client's choice before the title's override (ADR 0043), so a switch that
// is still storing, or whose store failed, stands across a quality pick, a Retry or a page restored.
interface PlayingAudio {
  start: PlaybackStart
  language: Language | undefined
}

// Where the player was asked to start: a pick holds only until the player is asked to start anew.
interface PlaybackStart {
  mediaFileId: string
  startPositionSeconds?: number
}

function playingAudio({ audio }: StreamTracks) {
  return audio.options.find((option) => option.id === audio.selected)
}

function startingChoice(start: PlaybackStart): ChoiceRequest {
  return { start, quality: 'AUTO' }
}

export function Player({
  mediaFileId,
  startPositionSeconds,
  title,
  mediaTitle,
  playbackPlatform,
}: Readonly<{
  mediaFileId: string
  startPositionSeconds?: number
  title?: PlayerTitle
  /** The episode or movie playing, which keeps the viewer's audio and subtitle switches. */
  mediaTitle?: PlayableMediaTitle
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
  const [choice, setChoice] = useState(() => startingChoice({ mediaFileId, startPositionSeconds }))
  // Another media title, or a new start position, starts in Auto from that start.
  if (
    choice.start.mediaFileId !== mediaFileId ||
    choice.start.startPositionSeconds !== startPositionSeconds
  ) {
    setChoice(startingChoice({ mediaFileId, startPositionSeconds }))
  }
  const { notice, marks, followPlaybackSession, announce } = usePlaybackFallbacks(choice.start)
  const [picker, setPicker] = useState<PickerKind | null>(null)
  const tracks = sourcePhase.at === 'attached' ? sourcePhase.tracks : null
  const qualities = sourcePhase.at === 'attached' ? sourcePhase.qualities : null
  const quality = {
    offered: qualities?.offered ?? [],
    selected: qualities?.playing ?? choice.quality,
    marks,
  }
  const streamTracks = useStreamTracks(tracks)
  const playingAudioLanguage = useRef<PlayingAudio>(null)
  useEffect(() => {
    const playing = playingAudio(streamTracks)
    if (playing) {
      playingAudioLanguage.current = {
        start: choice.start,
        language: languageOfTrack(playing.language),
      }
    }
  }, [streamTracks, choice.start])
  const openPicker =
    picker !== null && pickerOffersChoice(picker, { ...streamTracks, qualities: quality.offered })
      ? picker
      : null
  // A picker that loses its choices, or its stream with them, closes rather than reopen later.
  if (picker !== openPicker) {
    setPicker(null)
  }
  const reportTrackChosen = useLanguageSwitchReport(mediaTitle)
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
      createPlaybackSession: ({ capabilities, startPositionSeconds }) =>
        createPlaybackSession({
          variables: {
            input: {
              mediaFileId,
              capabilities,
              startPositionSeconds,
              options: {
                quality: choice.quality,
                audioLanguage:
                  playingAudioLanguage.current?.start === choice.start
                    ? playingAudioLanguage.current.language
                    : undefined,
              },
            },
          },
        }),
      startPositionSeconds,
      resumeFrom: choice.resumeFrom,
      onSourcePhase: setSourcePhase,
      onOutputShown: followPlaybackSession(),
      onNotice: announce,
    })
    playbackRef.current = playback
    return playback.stop
  }, [
    mediaFileId,
    startPositionSeconds,
    createPlaybackSession,
    client,
    playbackPlatform,
    choice,
    followPlaybackSession,
    announce,
  ])

  function chooseQuality(picked: VideoQuality) {
    const playback = playbackRef.current
    if (!playback || picked === quality.selected) {
      return
    }
    setChoice({ start: choice.start, quality: picked, resumeFrom: playback.resumePoint() })
  }

  function seek(seconds: number) {
    playbackRef.current?.seek(seconds)
  }

  // The pick's resume point is long past by now, so Retry starts where playback first started.
  function retry() {
    setChoice({ start: choice.start, quality: choice.quality })
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
          <Button display="block" mt="sm" onClick={retry}>
            Retry playback
          </Button>
        </Alert>
      )}
      <div className={styles.topStart}>
        <div ref={backRef} className={`${styles.back} ${styles.chrome}`}>
          <DetailBackButton />
        </div>
        <PlaybackNotice notice={notice} />
      </div>
      <PlayerControls
        ref={controlsRef}
        className={styles.chrome}
        playerRef={playerRef}
        videoRef={videoRef}
        videoState={videoState}
        onSeek={seek}
        tracks={tracks}
        quality={quality}
        onChooseQuality={chooseQuality}
        openPicker={openPicker}
        onOpenPicker={setPicker}
        onTrackChosen={reportTrackChosen}
        title={title}
      />
    </section>
  )
}
