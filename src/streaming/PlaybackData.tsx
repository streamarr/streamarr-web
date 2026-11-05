import { useQuery } from '@apollo/client/react'
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'
import {
  type PlaybackDecisionFieldsFragment,
  PlaybackDecisionsDocument,
  type SourceContainer,
  type VideoQuality,
  type VideoRange,
} from '../graphql/generated/graphql'
import { Icon } from '../ui/Icon'
import styles from './PlaybackData.module.css'
import { Fact, Facts, PlaybackDecisionTracks } from './PlaybackDecisionFacts'
import { placedReasons } from './playbackDecisionText'
import type { PlaybackPlatform } from './playbackCapabilities'
import {
  capturePlayerFigures,
  captureScreenFigures,
  playerFigureFacts,
  playerFiguresInput,
  screenFigureFacts,
} from './playerFigures'
import type { StreamStats } from './playerPlayback'
import { qualityLabel } from './qualityChoices'
import { SharePlaybackReport } from './SharePlaybackReport'

/** The attached stream that the panel describes. */
export interface PlaybackDataStream {
  playbackSessionId: string
  streamSessionId: string
  videoRange: VideoRange
  /** The playback choice that the viewer asked for, which the reasons name. */
  requestedChoice: VideoQuality
  /** The playback choice that plays now, which differs once Original has changed to Auto. */
  playingChoice: VideoQuality
  /** The container of a directly played file; null for HLS. */
  sourceContainer: SourceContainer | null
  streamStats: () => StreamStats
}

/** What the browser reports of the screen it shows the player on. */
export type PlaybackDataScreen = Pick<
  PlaybackPlatform,
  'screen' | 'displaysHighDynamicRange' | 'userAgent'
>

type Known<Value extends string> = Exclude<Value, '%future added value'>

const CONTAINERS: Record<Known<SourceContainer>, string> = {
  MP4: 'MP4',
  MOV: 'MOV',
  MATROSKA: 'MKV',
  MPEG_TS: 'MPEG-TS',
  MPEG_PS: 'MPEG-PS',
  AVI: 'AVI',
  ASF: 'ASF',
  FLV: 'FLV',
}

// The figures change as the element plays, stalls, buffers, resizes or loads another stream.
const VIDEO_EVENTS = [
  'timeupdate',
  'waiting',
  'progress',
  'resize',
  'loadedmetadata',
  'emptied',
] as const

/**
 * The playback-data panel over the video: how the server delivers the stream and why, what the
 * player reports of it, and what the browser reports of the screen. `stream` is null while no
 * stream is attached. It takes focus on Close as it opens, and Close or Escape hands focus back to
 * the control that had it. Escape closes it wherever focus is, unless `closesOnEscape` is false
 * because a menu that Escape closes first is open.
 */
export function PlaybackData({
  videoRef,
  stream,
  screen,
  controlsReach,
  closesOnEscape,
  onClose,
}: Readonly<{
  videoRef: RefObject<HTMLVideoElement | null>
  stream: PlaybackDataStream | null
  screen: PlaybackDataScreen
  /** How far the player's controls reach up from its bottom, in pixels; null before it is measured. */
  controlsReach: number | null
  closesOnEscape: boolean
  onClose: () => void
}>) {
  const headingId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<Element | null>(null)
  useEffect(() => {
    // StrictMode runs this twice; the second run finds Close already focused, not the opener.
    openerRef.current ??= document.activeElement
    closeButtonRef.current?.focus()
  }, [])
  const reach =
    controlsReach === null
      ? undefined
      : ({ '--controls-reach': `${controlsReach}px` } as CSSProperties)

  const close = useCallback(() => {
    if (openerRef.current instanceof HTMLElement) {
      openerRef.current.focus()
    }
    onClose()
  }, [onClose])
  useEffect(() => {
    if (!closesOnEscape) {
      return undefined
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [closesOnEscape, close])

  return (
    <section className={styles.panel} style={reach} aria-labelledby={headingId}>
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          Playback data
        </h2>
        {stream && (
          <section aria-label="Summary" className={styles.summary}>
            <dl className={styles.chips}>
              <Chip
                name="Quality"
                value={qualityLabel(stream.playingChoice) ?? stream.playingChoice}
              />
              <Chip name="Delivery" value={deliveryChipText(stream.sourceContainer)} />
            </dl>
          </section>
        )}
        <button
          ref={closeButtonRef}
          type="button"
          className={styles.close}
          aria-label="Close playback data"
          onClick={close}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      {stream ? (
        // Keyed by the stream session: a replacement that a status read finds already ready
        // attaches in the same render as the handover, so only the key mounts this anew to read
        // the decisions again.
        <StreamData
          key={stream.streamSessionId}
          videoRef={videoRef}
          stream={stream}
          screen={screen}
        />
      ) : (
        <p className={styles.note}>Waiting for the stream to start.</p>
      )}
    </section>
  )
}

function StreamData({
  videoRef,
  stream,
  screen,
}: Readonly<{
  videoRef: RefObject<HTMLVideoElement | null>
  stream: PlaybackDataStream
  screen: PlaybackDataScreen
}>) {
  const decision = usePlaybackDecision(stream)
  const reasons =
    decision.at === 'read'
      ? placedReasons({ decision: decision.decision, requestedChoice: stream.requestedChoice })
      : null
  return (
    <>
      {reasons && reasons.stream.length > 0 && (
        <ul className={styles.streamReasons} aria-label="Stream reasons">
          {reasons.stream.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <div className={styles.columns}>
        <Group name="Server">
          {decision.at === 'reading' && (
            <p className={styles.note}>Asking the server how it delivers this video…</p>
          )}
          {decision.at === 'missing' && (
            <div className={styles.failure}>
              <p className={styles.note}>The server couldn't say how it delivers this video.</p>
              <button type="button" className={styles.retry} onClick={decision.retry}>
                Retry
              </button>
            </div>
          )}
          {decision.at === 'read' && reasons && (
            <PlaybackDecisionTracks decision={decision.decision} reasons={reasons} />
          )}
        </Group>
        <div>
          <Group name="Player">
            <PlayerFacts
              videoRef={videoRef}
              streamStats={stream.streamStats}
              videoRange={stream.videoRange}
              playsHls={stream.sourceContainer === null}
            />
          </Group>
          <Group name="This screen">
            <FactList facts={screenFigureFacts(captureScreenFigures(screen))} />
          </Group>
        </div>
      </div>
      <SharePlaybackReport
        capture={() => ({
          playbackSessionId: stream.playbackSessionId,
          streamSessionId: stream.streamSessionId,
          player: playerFiguresInput(
            capturePlayerFigures({
              video: videoRef.current,
              stats: stream.streamStats(),
              videoRange: stream.videoRange,
              playsHls: stream.sourceContainer === null,
            }),
            captureScreenFigures(screen),
          ),
        })}
      />
    </>
  )
}

type DecisionRead =
  | { at: 'reading' }
  | { at: 'missing'; retry: () => void }
  | { at: 'read'; decision: PlaybackDecisionFieldsFragment }

function usePlaybackDecision({
  playbackSessionId,
  streamSessionId,
}: Pick<PlaybackDataStream, 'playbackSessionId' | 'streamSessionId'>): DecisionRead {
  const { data, loading, refetch } = useQuery(PlaybackDecisionsDocument, {
    variables: { id: playbackSessionId },
    // Each stream session's read stands alone: a read still out for the stream before would answer
    // for this one, and its late answer would overwrite this one's decisions in a shared cache.
    fetchPolicy: 'no-cache',
    context: { queryDeduplication: false },
  })
  if (loading) {
    return { at: 'reading' }
  }
  const decision = data?.playbackSession?.decisions.find(
    (candidate) => candidate.streamSessionId === streamSessionId,
  )
  if (decision) {
    return { at: 'read', decision }
  }
  // A failed read rejects its refetch too; the next render shows the failure again.
  return { at: 'missing', retry: () => void refetch().catch(() => undefined) }
}

function Chip({ name, value }: Readonly<{ name: string; value: string }>) {
  return (
    <div className={styles.chip}>
      <dt className={styles.chipName}>{name}</dt>
      <dd className={styles.chipValue}>{value}</dd>
    </div>
  )
}

function Group({ name, children }: Readonly<{ name: string; children: ReactNode }>) {
  const headingId = useId()
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.groupHeading}>
        {name}
      </h3>
      {children}
    </section>
  )
}

function deliveryChipText(container: SourceContainer | null): string {
  if (container === null) {
    return 'HLS'
  }
  const named = Object.hasOwn(CONTAINERS, container)
    ? CONTAINERS[container as Known<SourceContainer>]
    : container
  return `${named} → direct play`
}

type PlayerFigures = Record<string, string>

interface FiguresSource {
  videoRef: RefObject<HTMLVideoElement | null>
  streamStats: () => StreamStats
  videoRange: VideoRange
  /** Whether hls.js plays the stream, rather than the element playing the source file directly. */
  playsHls: boolean
}

function PlayerFacts({ videoRef, streamStats, videoRange, playsHls }: Readonly<FiguresSource>) {
  const store = useMemo(
    () => playerFiguresStore({ videoRef, streamStats, videoRange, playsHls }),
    [videoRef, streamStats, videoRange, playsHls],
  )
  const figures = useSyncExternalStore(store.subscribe, store.figures)
  return <FactList facts={figures} />
}

function FactList({ facts }: Readonly<{ facts: Record<string, string> }>) {
  return (
    <Facts>
      {Object.entries(facts).map(([name, value]) => (
        <Fact key={name} name={name} value={value} />
      ))}
    </Facts>
  )
}

// Hands React the same figures object until a figure changes, as useSyncExternalStore requires.
function playerFiguresStore({ videoRef, streamStats, ...kind }: FiguresSource) {
  let shown: { key: string; figures: PlayerFigures } | null = null
  return {
    subscribe: (onChange: () => void) => {
      const video = videoRef.current
      if (!video) {
        return () => undefined
      }
      for (const event of VIDEO_EVENTS) {
        video.addEventListener(event, onChange)
      }
      return () => {
        for (const event of VIDEO_EVENTS) {
          video.removeEventListener(event, onChange)
        }
      }
    },
    figures: (): PlayerFigures => {
      const figures = playerFigureFacts(
        capturePlayerFigures({ video: videoRef.current, stats: streamStats(), ...kind }),
      )
      const key = JSON.stringify(figures)
      if (shown?.key !== key) {
        shown = { key, figures }
      }
      return shown.figures
    },
  }
}
