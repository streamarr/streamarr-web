import { useApolloClient, useMutation } from '@apollo/client/react'
import { Alert, Button, VisuallyHidden } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CreatePlaybackSessionDocument,
  type Language,
  type VideoQuality,
} from '../graphql/generated/graphql'
import { languageOfTrack } from '../languages/languages'
import { DetailBackButton } from '../media/DetailBack'
import focusStyles from '../styles/focus.module.css'
import { BufferingRing } from './BufferingRing'
import { PlaybackData, type PlaybackDataScreen, type PlaybackDataStream } from './PlaybackData'
import { declarePlaybackCapabilities, type PlaybackPlatform } from './playbackCapabilities'
import styles from './Player.module.css'
import {
  type ChosenTrack,
  PlayerControls,
  type PickerKind,
  type PlayerTitle,
  pickerOpens,
} from './PlayerControls'
import {
  type PlayerPlayback,
  type ResumePoint,
  startPlayerPlayback,
  type SourcePhase,
} from './playerPlayback'
import { useControlsReach } from './useControlsReach'
import { hdrChoiceFor, hdrControlFor, type PlayingRanges } from './hdrControl'
import type { DynamicRangeChoice } from './hlsVideoPreference'
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
  /** The viewer's HDR choice, which only a fixed quality takes. */
  dynamicRange?: DynamicRangeChoice
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

// A source phase with the start whose playback reported it, so a stream attached from an earlier
// start is never taken for the current start's.
interface ReportedPhase {
  start: PlaybackStart
  phase: SourcePhase
}

function playingAudio({ audio }: StreamTracks) {
  return audio.options.find((option) => option.id === audio.selected)
}

function audioLanguageFrom(
  playing: PlayingAudio | null,
  start: PlaybackStart,
): Language | undefined {
  if (playing?.start !== start) {
    return undefined
  }
  return playing.language
}

function startingChoice(start: PlaybackStart): ChoiceRequest {
  return { start, quality: 'AUTO' }
}

function playingRanges(phase: Extract<SourcePhase, { at: 'attached' }>): PlayingRanges {
  return {
    choice: phase.qualities.playing,
    source: phase.sourceRange,
    output: phase.qualities.videoRange,
    declaresHdr: phase.declaresHdr,
  }
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
  const [reported, setReported] = useState<ReportedPhase | null>(null)
  const [choice, setChoice] = useState(() => startingChoice({ mediaFileId, startPositionSeconds }))
  // Another media title, or a new start position, starts in Auto from that start.
  if (
    choice.start.mediaFileId !== mediaFileId ||
    choice.start.startPositionSeconds !== startPositionSeconds
  ) {
    setChoice(startingChoice({ mediaFileId, startPositionSeconds }))
  }
  const sourcePhase = reported?.start === choice.start ? reported.phase : STARTING
  const {
    marks,
    cautions,
    announcement,
    followPlaybackSession,
    refuseAudioSwitch,
    clearAudioCaution,
  } = usePlaybackFallbacks(choice.start)
  const [picker, setPicker] = useState<PickerKind | null>(null)
  // The screen as the browser reported it when the viewer opened playback data; null while closed.
  const [playbackDataScreen, setPlaybackDataScreen] = useState<PlaybackDataScreen | null>(null)
  const tracks = sourcePhase.at === 'attached' ? sourcePhase.tracks : null
  const qualities = sourcePhase.at === 'attached' ? sourcePhase.qualities : null
  const ranges = sourcePhase.at === 'attached' ? playingRanges(sourcePhase) : null
  const quality = {
    offered: qualities?.offered ?? [],
    selected: qualities?.playing ?? choice.quality,
    marks,
    caution: cautions.quality,
    hdr: ranges ? hdrControlFor(ranges) : undefined,
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
    picker !== null &&
    pickerOpens(picker, { ...streamTracks, qualities: quality.offered, cautions })
      ? picker
      : null
  // A picker that loses its choices, or its stream with them, closes rather than reopen later.
  if (picker !== openPicker) {
    setPicker(null)
  }
  const reportTrackChosen = useLanguageSwitchReport(mediaTitle)
  const videoState = useVideoState(videoRef)
  // Playback data sits above the controls and takes taps, so the controls stay while it shows.
  const controlsHeld =
    videoState.paused ||
    sourcePhase.at === 'failed' ||
    openPicker !== null ||
    playbackDataScreen !== null
  const idle = useIdle(controlsHeld, [controlsRef, backRef])
  const controlsReach = useControlsReach({
    playerRef,
    controlsRef,
    watching: playbackDataScreen !== null,
  })

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return undefined
    }
    const reportSourcePhase = (phase: SourcePhase) => setReported({ start: choice.start, phase })
    reportSourcePhase(STARTING)

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
                dynamicRange: choice.dynamicRange,
                audioLanguage: audioLanguageFrom(playingAudioLanguage.current, choice.start),
              },
            },
          },
        }),
      startPositionSeconds,
      dynamicRange: choice.dynamicRange ?? 'HDR',
      resumeFrom: choice.resumeFrom,
      onSourcePhase: reportSourcePhase,
      onOutputShown: followPlaybackSession(),
      onAudioSwitchRefused: refuseAudioSwitch,
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
    refuseAudioSwitch,
  ])

  function chooseQuality(picked: VideoQuality) {
    const playback = playbackRef.current
    if (!playback || picked === quality.selected) {
      return
    }
    setChoice({
      start: choice.start,
      quality: picked,
      dynamicRange: hdrChoiceFor(picked, ranges),
      resumeFrom: playback.resumePoint(),
    })
  }

  // The toggle asks for the other range in the fixed quality that plays.
  function toggleHdr() {
    const playback = playbackRef.current
    const { hdr } = quality
    if (!playback || !hdr || hdr.unavailable) {
      return
    }
    setChoice({
      start: choice.start,
      quality: quality.selected,
      dynamicRange: hdr.on ? 'SDR' : 'HDR',
      resumeFrom: playback.resumePoint(),
    })
  }

  // A new audio pick is the viewer's new choice, which a caution about an earlier one no longer
  // describes.
  function trackChosen(chosen: ChosenTrack) {
    if (chosen.kind === 'audio') {
      clearAudioCaution()
    }
    reportTrackChosen(chosen)
  }

  function seek(seconds: number) {
    playbackRef.current?.seek(seconds)
  }

  const describedStream: PlaybackDataStream | null =
    sourcePhase.at === 'attached'
      ? {
          playbackSessionId: sourcePhase.playbackSessionId,
          streamSessionId: sourcePhase.streamSessionId,
          videoRange: sourcePhase.videoRange,
          requestedChoice: sourcePhase.qualities.requested,
          playingChoice: sourcePhase.qualities.playing,
          sourceContainer: sourcePhase.sourceContainer,
          streamStats: sourcePhase.streamStats,
        }
      : null

  const closePlaybackData = useCallback(() => setPlaybackDataScreen(null), [])

  function togglePlaybackData() {
    const video = videoRef.current
    if (playbackDataScreen || !video) {
      setPlaybackDataScreen(null)
      return
    }
    const { screen, displaysHighDynamicRange, userAgent } = playbackPlatform(video)
    setPlaybackDataScreen({ screen, displaysHighDynamicRange, userAgent })
  }

  // The pick's resume point is long past by now, so Retry starts where playback first started.
  function retry() {
    setChoice({ start: choice.start, quality: choice.quality, dynamicRange: choice.dynamicRange })
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
      </div>
      {/* Stays in the page while empty, so each caution's message is announced once, politely. */}
      <VisuallyHidden>
        <output>
          {announcement && <span key={announcement.serial}>{announcement.text}</span>}
        </output>
      </VisuallyHidden>
      {playbackDataScreen && (
        <PlaybackData
          videoRef={videoRef}
          stream={describedStream}
          screen={playbackDataScreen}
          controlsReach={controlsReach}
          closesOnEscape={openPicker === null}
          onClose={closePlaybackData}
        />
      )}
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
        onToggleHdr={toggleHdr}
        openPicker={openPicker}
        onOpenPicker={setPicker}
        audioCaution={cautions.audio}
        onTrackChosen={trackChosen}
        playbackDataShown={playbackDataScreen !== null}
        onTogglePlaybackData={togglePlaybackData}
        title={title}
      />
    </section>
  )
}
