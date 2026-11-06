import { Slider } from '@mantine/core'
import { type Ref, type RefObject, useEffect, useId, useRef, useState } from 'react'
import type { VideoQuality } from '../graphql/generated/graphql'
import { formatTimecode } from '../media/formatting'
import { Icon, type IconName } from '../ui/Icon'
import { CaretPopover, type PopoverOption } from './CaretPopover'
import styles from './PlayerControls.module.css'
import { qualityChipValue, qualityLabel } from './qualityChoices'
import type { QualityMarks } from './usePlaybackFallbacks'
import type { StreamTracks, TrackSource } from './trackSources'
import { useSpaceToPlayOrPause } from './useSpaceToPlayOrPause'
import { useStreamTracks } from './useStreamTracks'
import type { VideoState } from './useVideoState'

const SKIP_SECONDS = 10

/** The title line's text: the media title, then what of it is playing, such as an episode. */
export interface PlayerTitle {
  heading: string
  detail?: string
}

export type PickerKind = 'quality' | 'audio' | 'subtitles' | 'menu'

/**
 * The quality menu's choices, empty while no stream is attached, the choice it shows selected, and
 * the explanation beside each choice whose output fell back.
 */
interface QualityMenu {
  offered: readonly VideoQuality[]
  selected: VideoQuality
  marks: QualityMarks
}

/** What each picker offers: the stream's tracks and the playback choices the server lists. */
type PickerChoices = StreamTracks & { qualities: readonly VideoQuality[] }

// Mantine's slider ends a drag only on touchend or mouseup. After a cancelled touch its drag stays
// open until the next touchend or mouseup anywhere, and that late end must not seek.
type Scrub = { at: 'dragging'; seconds: number; resume: boolean } | { at: 'abandoned' }

const SUBTITLES_OFF: PopoverOption<null> = { id: null, label: 'Off' }

const PLAYBACK_DATA = 'playback-data'
const PLAYER_MENU: readonly PopoverOption<typeof PLAYBACK_DATA>[] = [
  { id: PLAYBACK_DATA, label: 'Playback data' },
]

/**
 * Whether a picker has a choice to make: one option alone would only repeat what its chip shows.
 * The subtitles picker always offers Off beside the stream's tracks, and the player menu always
 * offers its items.
 */
export function pickerOffersChoice(
  kind: PickerKind,
  { audio, subtitles, qualities }: PickerChoices,
): boolean {
  switch (kind) {
    case 'quality':
      return qualityOptions(qualities).length > 1
    case 'audio':
      return audio.options.length > 1
    case 'subtitles':
      return subtitles.options.length > 0
    case 'menu':
      return true
  }
}

// A choice the server added after this client has no name here, so the menu leaves it out.
function qualityOptions(
  qualities: readonly VideoQuality[],
  marks: QualityMarks = new Map(),
): PopoverOption<VideoQuality>[] {
  return qualities.flatMap((id) => {
    const label = qualityLabel(id)
    return label ? [{ id, label, caution: marks.get(id) }] : []
  })
}

export function PlayerControls({
  ref,
  className,
  playerRef,
  videoRef,
  videoState,
  onSeek,
  tracks,
  quality,
  onChooseQuality,
  openPicker,
  onOpenPicker,
  playbackDataShown,
  onTogglePlaybackData,
  title,
}: Readonly<{
  ref: Ref<HTMLDivElement>
  className: string
  /** The element that takes the screen in full screen, so the bar stays over the video. */
  playerRef: RefObject<HTMLElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  videoState: VideoState
  /** Moves the playhead. The controls never seek the element themselves. */
  onSeek: (seconds: number) => void
  /** The attached stream's tracks; null while no stream is attached. */
  tracks: TrackSource | null
  quality: QualityMenu
  onChooseQuality: (choice: VideoQuality) => void
  openPicker: PickerKind | null
  onOpenPicker: (kind: PickerKind | null) => void
  playbackDataShown: boolean
  onTogglePlaybackData: () => void
  title?: PlayerTitle
}>) {
  const [scrub, setScrub] = useState<Scrub | null>(null)
  const attached = tracks !== null
  const streamTracks = useStreamTracks(tracks)
  const { audio, subtitles } = streamTracks
  const choices = { ...streamTracks, qualities: quality.offered }
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
    onSeek(Math.min(Math.max(element.currentTime + seconds, 0), element.duration))
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
    onSeek(seconds)
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
          <ChoicePicker
            name="Quality"
            icon="quality"
            options={qualityOptions(quality.offered, quality.marks)}
            selected={quality.selected}
            value={qualityChipValue(quality.selected, videoState.videoHeight)}
            choosable={pickerOffersChoice('quality', choices)}
            open={openPicker === 'quality'}
            onOpenChange={(open) => onOpenPicker(open ? 'quality' : null)}
            onChoose={onChooseQuality}
          />
          <ChoicePicker
            name="Audio"
            icon="audio-track"
            options={audio.options}
            selected={audio.selected}
            choosable={pickerOffersChoice('audio', choices)}
            open={openPicker === 'audio'}
            onOpenChange={(open) => onOpenPicker(open ? 'audio' : null)}
            onChoose={(id) => tracks?.selectAudio(id)}
          />
          <ChoicePicker
            name="Subtitles"
            icon="subtitles"
            options={[SUBTITLES_OFF, ...subtitles.options]}
            selected={subtitles.selected}
            showsActiveTrack={subtitles.selected !== null}
            choosable={pickerOffersChoice('subtitles', choices)}
            open={openPicker === 'subtitles'}
            onOpenChange={(open) => onOpenPicker(open ? 'subtitles' : null)}
            onChoose={(id) => tracks?.selectSubtitles(id)}
          />
          <ChoicePicker
            name="Settings"
            icon="settings"
            options={PLAYER_MENU}
            selected={playbackDataShown ? PLAYBACK_DATA : null}
            value=""
            choosable
            open={openPicker === 'menu'}
            onOpenChange={(open) => onOpenPicker(open ? 'menu' : null)}
            onChoose={onTogglePlaybackData}
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
      {title && <h1 className={styles.heading}>{title.heading}</h1>}
      <span className={styles.detail}>
        {title?.detail && (
          <>
            <span className={styles.detailText}>{title.detail}</span>
            <span className={styles.separator} data-pending={!timecode || undefined}>
              {' · '}
            </span>
          </>
        )}
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

function ChoicePicker<Id extends string | number | null>({
  name,
  icon,
  options,
  selected,
  value = options.find((option) => option.id === selected)?.label,
  showsActiveTrack,
  choosable,
  open,
  onOpenChange,
  onChoose,
}: Readonly<{
  name: string
  icon: IconName
  options: readonly PopoverOption<Id>[]
  selected: Id | null
  /** What the chip shows; the selected option's label unless given. */
  value?: string
  showsActiveTrack?: boolean
  choosable: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (id: Id) => void
}>) {
  const chipRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const menu = choosable
    ? { ref: chipRef, id: menuId, open, toggle: () => onOpenChange(!open) }
    : undefined

  return (
    <>
      <StatusChip
        name={name}
        icon={icon}
        value={value}
        showsActiveTrack={showsActiveTrack}
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
  showsActiveTrack = false,
  menu,
}: Readonly<{
  name: string
  icon: IconName
  value?: string
  showsActiveTrack?: boolean
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
      {showsActiveTrack && <span className={styles.activeTrack} data-testid="active-track" />}
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
