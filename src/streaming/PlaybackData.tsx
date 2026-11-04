import { useQuery } from '@apollo/client/react'
import { type ReactNode, type RefObject, useId, useMemo, useSyncExternalStore } from 'react'
import { PlaybackDecisionsDocument, type VideoRange } from '../graphql/generated/graphql'
import { Icon } from '../ui/Icon'
import styles from './PlaybackData.module.css'
import { Fact, Facts, PlaybackDecisionFacts } from './PlaybackDecisionFacts'
import { bitrateText, channelsText, videoRangeText } from './playbackDecisionText'
import type { StreamStats } from './playerPlayback'

/** The attached stream that the panel describes. */
export interface PlaybackDataStream {
  playbackSessionId: string
  streamSessionId: string
  videoRange: VideoRange
  streamStats: () => StreamStats
}

const NOT_KNOWN = 'Not known'

// The figures change as the element plays, buffers, resizes or loads another stream.
const VIDEO_EVENTS = ['timeupdate', 'progress', 'resize', 'loadedmetadata', 'emptied'] as const

const seconds = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const counts = new Intl.NumberFormat('en-US')

/**
 * The playback-data panel over the video: what the player reports of the stream it plays, and how
 * the server delivers it and why. `stream` is null while no stream is attached.
 */
export function PlaybackData({
  videoRef,
  stream,
  onClose,
}: Readonly<{
  videoRef: RefObject<HTMLVideoElement | null>
  stream: PlaybackDataStream | null
  onClose: () => void
}>) {
  const headingId = useId()
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          Playback data
        </h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Close playback data"
          onClick={onClose}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      {stream ? (
        <>
          <Group name="Player">
            <PlayerFacts
              videoRef={videoRef}
              streamStats={stream.streamStats}
              videoRange={stream.videoRange}
            />
          </Group>
          <Group name="Server">
            <ServerDecision
              key={stream.streamSessionId}
              playbackSessionId={stream.playbackSessionId}
              streamSessionId={stream.streamSessionId}
            />
          </Group>
        </>
      ) : (
        <p className={styles.note}>Waiting for the stream to start.</p>
      )}
    </section>
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

type PlayerFigures = Record<string, string>

interface FiguresSource {
  videoRef: RefObject<HTMLVideoElement | null>
  streamStats: () => StreamStats
  videoRange: VideoRange
}

function PlayerFacts({ videoRef, streamStats, videoRange }: Readonly<FiguresSource>) {
  const store = useMemo(
    () => playerFiguresStore({ videoRef, streamStats, videoRange }),
    [videoRef, streamStats, videoRange],
  )
  const figures = useSyncExternalStore(store.subscribe, store.figures)
  return (
    <Facts>
      {Object.entries(figures).map(([name, value]) => (
        <Fact key={name} name={name} value={value} />
      ))}
    </Facts>
  )
}

// Hands React the same figures object until a figure changes, as useSyncExternalStore requires.
function playerFiguresStore({ videoRef, streamStats, videoRange }: FiguresSource) {
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
      const figures = playerFigures(videoRef.current, streamStats(), videoRange)
      const key = JSON.stringify(figures)
      if (shown?.key !== key) {
        shown = { key, figures }
      }
      return shown.figures
    },
  }
}

function playerFigures(
  video: HTMLVideoElement | null,
  stats: StreamStats,
  videoRange: VideoRange,
): PlayerFigures {
  return {
    Resolution:
      video && video.videoWidth > 0 ? `${video.videoWidth}×${video.videoHeight}` : NOT_KNOWN,
    Bitrate: stats.bitrate === undefined ? NOT_KNOWN : bitrateText(stats.bitrate),
    'Connection estimate':
      stats.bandwidthEstimate === undefined ? NOT_KNOWN : bitrateText(stats.bandwidthEstimate),
    Buffer: `${seconds.format(video ? bufferedAhead(video) : 0)} s`,
    'Dropped frames': droppedFrames(video),
    'Video codec': stats.videoCodec ?? NOT_KNOWN,
    'HDR mode': videoRangeText(videoRange),
    'Audio format': audioFormat(stats),
  }
}

// The seconds the element holds past the playhead, in the buffered range that holds the playhead.
function bufferedAhead(video: HTMLVideoElement): number {
  const { buffered, currentTime } = video
  for (let index = 0; index < buffered.length; index++) {
    if (buffered.start(index) <= currentTime && currentTime <= buffered.end(index)) {
      return buffered.end(index) - currentTime
    }
  }
  return 0
}

function droppedFrames(video: HTMLVideoElement | null): string {
  // Not every browser reports decoded frames; TypeScript's DOM library declares that it does.
  const quality = (video as Partial<HTMLVideoElement> | null)?.getVideoPlaybackQuality?.()
  if (!quality) {
    return NOT_KNOWN
  }
  return `${counts.format(quality.droppedVideoFrames)} of ${counts.format(quality.totalVideoFrames)}`
}

function audioFormat({ audioCodec, audioChannels }: StreamStats): string {
  if (!audioCodec) {
    return NOT_KNOWN
  }
  return audioChannels === undefined ? audioCodec : `${audioCodec} · ${channelsText(audioChannels)}`
}

// Keyed by the stream session: a replacement that a status read finds already ready attaches in
// the same render as the handover, so only the key mounts this anew to read the decisions again.
function ServerDecision({
  playbackSessionId,
  streamSessionId,
}: Readonly<{ playbackSessionId: string; streamSessionId: string }>) {
  const { data, loading } = useQuery(PlaybackDecisionsDocument, {
    variables: { id: playbackSessionId },
    fetchPolicy: 'network-only',
    // A read still out for the stream before would answer for this one without its decision.
    context: { queryDeduplication: false },
  })
  if (loading) {
    return <p className={styles.note}>Reading the server's decision…</p>
  }
  const decision = data?.playbackSession?.decisions.find(
    (candidate) => candidate.streamSessionId === streamSessionId,
  )
  if (!decision) {
    return <p className={styles.note}>The server's decision for this stream isn't available.</p>
  }
  return <PlaybackDecisionFacts decision={decision} />
}
