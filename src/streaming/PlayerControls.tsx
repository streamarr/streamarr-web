import { Slider } from '@mantine/core'
import { type RefObject, useState } from 'react'
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
  videoRef,
  video,
  attached,
  title,
}: Readonly<{
  videoRef: RefObject<HTMLVideoElement | null>
  video: VideoState
  attached: boolean
  title?: PlayerTitle
}>) {
  const [scrub, setScrub] = useState<Scrub | null>(null)
  const length = Number.isFinite(video.duration)
    ? formatTimecode(video.duration, video.duration)
    : null
  const seekable = attached && length !== null
  const position = scrub?.seconds ?? video.currentTime

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
    <div className={styles.bar}>
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
        max={seekable ? video.duration : 1}
        step={1}
        value={seekable ? position : 0}
        disabled={!seekable}
        label={null}
        thumbLabel="Seek"
        thumbValueText={
          seekable
            ? (seconds) => `${formatTimecode(seconds, video.duration)} of ${length}`
            : undefined
        }
        onPointerDown={startScrub}
        onChange={moveScrub}
        onChangeEnd={seek}
      />
      <div className={styles.row}>
        <div className={styles.start}>
          <TitleLine
            title={title}
            timecode={length && `${formatTimecode(position, video.duration)} / ${length}`}
          />
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
            aria-label={video.paused ? 'Play' : 'Pause'}
            disabled={!attached}
            onClick={togglePaused}
          >
            <Icon
              name={video.paused ? 'play' : 'pause'}
              className={video.paused ? styles.playGlyph : undefined}
            />
          </button>
          <SkipButton
            label={`Forward ${SKIP_SECONDS} seconds`}
            icon="skip-forward"
            disabled={!seekable}
            onSkip={() => skip(SKIP_SECONDS)}
          />
        </div>
        <div className={styles.end} />
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
