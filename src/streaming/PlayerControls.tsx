import { Slider } from '@mantine/core'
import { type Ref, type RefObject, useEffect, useState } from 'react'
import { formatTimecode } from '../media/formatting'
import { Icon, type IconName } from '../ui/Icon'
import styles from './PlayerControls.module.css'
import type { VideoState } from './useVideoState'

const SKIP_SECONDS = 10

/** The title line's text: the media title, then what of it is playing, such as an episode. */
export interface PlayerTitle {
  heading: string
  detail?: string
}

interface Scrub {
  seconds: number
  resume: boolean
}

export function PlayerControls({
  ref,
  className,
  playerRef,
  videoRef,
  videoState,
  attached,
  title,
}: Readonly<{
  ref: Ref<HTMLDivElement>
  className: string
  /** The element that takes the screen in full screen, so the bar stays over the video. */
  playerRef: RefObject<HTMLElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  videoState: VideoState
  attached: boolean
  title?: PlayerTitle
}>) {
  const [scrub, setScrub] = useState<Scrub | null>(null)
  const durationKnown = Number.isFinite(videoState.duration)
  const timecodeAt = (seconds: number) =>
    formatTimecode({ positionSeconds: seconds, durationSeconds: videoState.duration })
  const durationTimecode = durationKnown ? timecodeAt(videoState.duration) : null
  const seekable = attached && durationKnown
  const position = scrub?.seconds ?? videoState.currentTime

  function togglePaused() {
    const element = videoRef.current
    if (!element) {
      return
    }
    if (element.paused) {
      void element.play().catch(ignoreInterruptedPlay)
      return
    }
    element.pause()
  }

  function skip(seconds: number) {
    const element = videoRef.current
    if (!element) {
      return
    }
    element.currentTime = Math.min(Math.max(element.currentTime + seconds, 0), element.duration)
  }

  // Only a pointer drag pauses: the keyboard seeks in steps, and each step lands at once.
  function startScrub() {
    const element = videoRef.current
    if (!element || !seekable) {
      return
    }
    setScrub({ seconds: element.currentTime, resume: !element.paused })
    element.pause()
  }

  function moveScrub(seconds: number) {
    setScrub((current) => current && { ...current, seconds })
  }

  function seek(seconds: number) {
    const element = videoRef.current
    setScrub(null)
    if (!element) {
      return
    }
    element.currentTime = seconds
    if (scrub?.resume) {
      void element.play().catch(ignoreInterruptedPlay)
    }
  }

  return (
    <div ref={ref} className={`${styles.bar} ${className}`}>
      <Slider
        classNames={{
          root: styles.seek,
          trackContainer: styles.seekHit,
          track: styles.seekTrack,
          bar: styles.seekFill,
          thumb: styles.seekThumb,
        }}
        size={4}
        thumbSize={12}
        min={0}
        max={seekable ? videoState.duration : 1}
        step={1}
        value={seekable ? position : 0}
        disabled={!seekable}
        label={null}
        thumbLabel="Seek"
        thumbValueText={
          seekable ? (seconds) => `${timecodeAt(seconds)} of ${durationTimecode}` : undefined
        }
        onPointerDown={startScrub}
        onChange={moveScrub}
        onChangeEnd={seek}
      />
      <div className={styles.row}>
        <div className={styles.start}>
          <TitleLine
            title={title}
            timecode={durationTimecode && `${timecodeAt(position)} / ${durationTimecode}`}
          />
          <VolumeControl videoRef={videoRef} volume={videoState.volume} muted={videoState.muted} />
        </div>
        <div className={styles.transport}>
          <SkipButton
            label={`Back ${SKIP_SECONDS} seconds`}
            icon="skip-back"
            disabled={!seekable}
            onSkip={() => skip(-SKIP_SECONDS)}
          />
          <button
            type="button"
            className={styles.playPause}
            aria-label={videoState.paused ? 'Play' : 'Pause'}
            disabled={!attached}
            onClick={togglePaused}
          >
            <Icon
              name={videoState.paused ? 'play' : 'pause'}
              className={videoState.paused ? styles.playGlyph : undefined}
            />
          </button>
          <SkipButton
            label={`Forward ${SKIP_SECONDS} seconds`}
            icon="skip-forward"
            disabled={!seekable}
            onSkip={() => skip(SKIP_SECONDS)}
          />
        </div>
        <div className={styles.end}>
          <QualityChip videoHeight={videoState.videoHeight} />
          <FullscreenButton targetRef={playerRef} />
        </div>
      </div>
    </div>
  )
}

function TitleLine({
  title,
  timecode,
}: Readonly<{ title?: PlayerTitle; timecode: string | null }>) {
  return (
    <div className={styles.titleLine}>
      {title && <span className={styles.heading}>{title.heading}</span>}
      <span className={styles.detail}>
        {title?.detail}
        {title?.detail && timecode && ' · '}
        {timecode && <span className={styles.timecode}>{timecode}</span>}
      </span>
    </div>
  )
}

function VolumeControl({
  videoRef,
  volume,
  muted,
}: Readonly<{ videoRef: RefObject<HTMLVideoElement | null>; volume: number; muted: boolean }>) {
  const audible = !muted && volume > 0

  function toggleMuted() {
    const element = videoRef.current
    if (!element) {
      return
    }
    if (audible) {
      element.muted = true
      return
    }
    element.muted = false
    if (element.volume === 0) {
      element.volume = 1
    }
  }

  function changeVolume(level: number) {
    const element = videoRef.current
    if (!element) {
      return
    }
    element.volume = level
    element.muted = false
  }

  return (
    <div className={styles.volume}>
      <button
        type="button"
        className={styles.volumeToggle}
        aria-label={audible ? 'Mute' : 'Unmute'}
        onClick={toggleMuted}
      >
        <Icon name={audible ? 'volume' : 'muted'} size={16} />
      </button>
      <Slider
        classNames={{
          root: styles.volumeSlider,
          track: styles.volumeTrack,
          bar: styles.volumeFill,
          thumb: styles.volumeThumb,
        }}
        size={4}
        thumbSize={10}
        min={0}
        max={1}
        step={0.05}
        value={audible ? volume : 0}
        label={null}
        thumbLabel="Volume"
        thumbValueText={(level) => `${Math.round(level * 100)}%`}
        onChange={changeVolume}
      />
    </div>
  )
}

// Holds the quality menu's place and shows the quality in use until the menu has choices to offer.
function QualityChip({ videoHeight }: Readonly<{ videoHeight: number }>) {
  const quality = videoHeight > 0 ? `Auto · ${videoHeight}p` : 'Auto'
  return (
    <button
      type="button"
      className={styles.chip}
      aria-label={`Quality: ${quality}`}
      aria-disabled="true"
    >
      <Icon name="quality" size={16} />
      <span className={styles.chipValue}>{quality}</span>
    </button>
  )
}

function FullscreenButton({ targetRef }: Readonly<{ targetRef: RefObject<HTMLElement | null> }>) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const syncFullscreen = () => setActive(document.fullscreenElement === targetRef.current)
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [targetRef])

  if (!document.fullscreenEnabled) {
    return null
  }

  function toggle() {
    if (active) {
      void document.exitFullscreen().catch(ignoreRefusedFullscreen)
      return
    }
    void targetRef.current?.requestFullscreen().catch(ignoreRefusedFullscreen)
  }

  return (
    <button
      type="button"
      className={`${styles.chip} ${styles.iconChip}`}
      aria-label={active ? 'Exit full screen' : 'Full screen'}
      onClick={toggle}
    >
      <Icon name={active ? 'exit-fullscreen' : 'fullscreen'} size={16} />
    </button>
  )
}

function SkipButton({
  label,
  icon,
  disabled,
  onSkip,
}: Readonly<{ label: string; icon: IconName; disabled: boolean; onSkip: () => void }>) {
  return (
    <button
      type="button"
      className={styles.skip}
      aria-label={label}
      disabled={disabled}
      onClick={onSkip}
    >
      <Icon name={icon} size={32} />
      <span className={styles.skipLabel} aria-hidden>
        {SKIP_SECONDS}
      </span>
    </button>
  )
}

function ignoreInterruptedPlay() {
  // A pause or a released stream interrupts play(); the element's own events already show it.
}

function ignoreRefusedFullscreen() {
  // The browser may refuse full screen; the page then simply stays as it is.
}
