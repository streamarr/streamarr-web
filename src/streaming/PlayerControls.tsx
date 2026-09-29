import { Slider } from '@mantine/core'
import { type Ref, type RefObject, useEffect, useId, useRef, useState } from 'react'
import { formatTimecode } from '../media/formatting'
import { Icon, type IconName } from '../ui/Icon'
import { CaretPopover, type PopoverOption } from './CaretPopover'
import styles from './PlayerControls.module.css'
import type { TrackSource } from './trackSources'
import { usePlaybackTracks } from './usePlaybackTracks'
import { useSpaceToPlayOrPause } from './useSpaceToPlayOrPause'
import type { VideoState } from './useVideoState'

const SKIP_SECONDS = 10

/** The title line's text: the media title, then what of it is playing, such as an episode. */
export interface PlayerTitle {
  heading: string
  detail?: string
}

export type TrackPickerKind = 'audio' | 'subtitles'

// Mantine's slider ends a drag only on touchend or mouseup. After a cancelled touch its drag stays
// open until the next touchend or mouseup anywhere, and that late end must not seek.
type Scrub = { at: 'dragging'; seconds: number; resume: boolean } | { at: 'abandoned' }

const SUBTITLES_OFF: PopoverOption<null> = { id: null, label: 'Off' }

export function PlayerControls({
  ref,
  className,
  playerRef,
  videoRef,
  videoState,
  attached,
  tracks,
  openPicker,
  onOpenPicker,
  title,
}: Readonly<{
  ref: Ref<HTMLDivElement>
  className: string
  /** The element that takes the screen in full screen, so the bar stays over the video. */
  playerRef: RefObject<HTMLElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  videoState: VideoState
  attached: boolean
  tracks: TrackSource | null
  openPicker: TrackPickerKind | null
  onOpenPicker: (kind: TrackPickerKind | null) => void
  title?: PlayerTitle
}>) {
  const [scrub, setScrub] = useState<Scrub | null>(null)
  const { audio, subtitles } = usePlaybackTracks(tracks)
  const durationKnown = Number.isFinite(videoState.duration)
  const timecodeAt = (seconds: number) =>
    formatTimecode({ positionSeconds: seconds, durationSeconds: videoState.duration })
  const durationTimecode = durationKnown ? timecodeAt(videoState.duration) : null
  const seekable = attached && durationKnown
  const position = scrub?.at === 'dragging' ? scrub.seconds : videoState.currentTime
  useSpaceToPlayOrPause(attached, togglePaused)

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

  // Only a pointer drag pauses: the keyboard seeks in steps, and each step lands at once. The
  // slider drags only from its track container, which alone ends the scrub it starts.
  function startScrub() {
    const element = videoRef.current
    if (!element || !seekable) {
      return
    }
    setScrub({ at: 'dragging', seconds: element.currentTime, resume: !element.paused })
    element.pause()
  }

  function moveScrub(seconds: number) {
    setScrub((current) => (current?.at === 'dragging' ? { ...current, seconds } : current))
  }

  function abandonScrub() {
    const element = videoRef.current
    if (scrub?.at !== 'dragging') {
      return
    }
    setScrub({ at: 'abandoned' })
    if (!element || !attached || !scrub.resume) {
      return
    }
    void element.play().catch(ignoreInterruptedPlay)
  }

  function seek(seconds: number) {
    const element = videoRef.current
    setScrub(null)
    if (!element || !attached || scrub?.at === 'abandoned') {
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
          track: styles.sliderTrack,
          bar: styles.sliderFill,
          thumb: `${styles.sliderThumb} ${styles.seekThumb}`,
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
        attributes={{ trackContainer: { onPointerDown: startScrub, onTouchCancel: abandonScrub } }}
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
            className={`${styles.iconButton} ${styles.playPause}`}
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
          <TrackPicker
            name="Audio"
            icon="audio-track"
            options={audio.options}
            selected={audio.selected}
            open={openPicker === 'audio'}
            onOpenChange={(open) => onOpenPicker(open ? 'audio' : null)}
            onChoose={(id) => tracks?.selectAudio(id)}
          />
          <TrackPicker
            name="Subtitles"
            icon="subtitles"
            options={[SUBTITLES_OFF, ...subtitles.options]}
            selected={subtitles.selected}
            marked={subtitles.selected !== null}
            open={openPicker === 'subtitles'}
            onOpenChange={(open) => onOpenPicker(open ? 'subtitles' : null)}
            onChoose={(id) => tracks?.selectSubtitles(id)}
          />
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
        <span className={styles.timecode}>{timecode}</span>
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
        className={`${styles.iconButton} ${styles.volumeToggle}`}
        aria-label={audible ? 'Mute' : 'Unmute'}
        onClick={toggleMuted}
      >
        <Icon name={audible ? 'volume' : 'muted'} size={16} />
      </button>
      <Slider
        classNames={{
          root: styles.volumeSlider,
          track: styles.sliderTrack,
          bar: styles.sliderFill,
          thumb: `${styles.sliderThumb} ${styles.volumeThumb}`,
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
  return (
    <StatusChip
      name="Quality"
      icon="quality"
      value={videoHeight > 0 ? `Auto · ${videoHeight}p` : 'Auto'}
    />
  )
}

// A picker opens only with a choice to make; one option alone would repeat what the chip shows.
function TrackPicker<Id extends number | null>({
  name,
  icon,
  options,
  selected,
  marked,
  open,
  onOpenChange,
  onChoose,
}: Readonly<{
  name: string
  icon: IconName
  options: readonly PopoverOption<Id>[]
  selected: Id | null
  marked?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (id: Id) => void
}>) {
  const chipRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const choosable = options.length > 1
  const menu = choosable
    ? { ref: chipRef, id: menuId, open, toggle: () => onOpenChange(!open) }
    : undefined

  return (
    <>
      <StatusChip
        name={name}
        icon={icon}
        value={options.find((option) => option.id === selected)?.label}
        marked={marked}
        menu={menu}
      />
      {choosable && open && (
        <CaretPopover
          id={menuId}
          heading={name}
          anchorRef={chipRef}
          options={options}
          selected={selected}
          onChoose={(id) => {
            onChoose(id)
            onOpenChange(false)
          }}
          onDismiss={() => onOpenChange(false)}
        />
      )}
    </>
  )
}

interface ChipMenu {
  ref: RefObject<HTMLButtonElement | null>
  id: string
  open: boolean
  toggle: () => void
}

function StatusChip({
  name,
  icon,
  value,
  marked = false,
  menu,
}: Readonly<{
  name: string
  icon: IconName
  /** Omitted while the setting has no known value. */
  value?: string
  /** Whether the setting is on, such as subtitles showing. */
  marked?: boolean
  /** The menu the chip opens; without one it only shows the setting. */
  menu?: ChipMenu
}>) {
  return (
    <button
      ref={menu?.ref}
      type="button"
      className={styles.chip}
      aria-label={value ? `${name}: ${value}` : name}
      aria-disabled={!menu || undefined}
      aria-haspopup={menu && 'menu'}
      aria-expanded={menu?.open}
      aria-controls={menu?.open ? menu.id : undefined}
      onClick={menu?.toggle}
    >
      {marked && <span className={styles.activeTrack} />}
      <Icon name={icon} size={16} />
      {value && <span className={styles.chipValue}>{value}</span>}
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
      className={`${styles.iconButton} ${styles.skip}`}
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
