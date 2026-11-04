import { Alert, Center, Loader } from '@mantine/core'
import type {
  ActiveStreamFieldsFragment,
  PlaybackDecisionFieldsFragment,
} from '../../graphql/generated/graphql'
import { isForbidden } from '../../graphql/errorRouting'
import { requestFailureMessage } from '../../graphql/requestErrors'
import { formatEpisodeLabel, formatTimecode } from '../../media/formatting'
import { Fact, Facts, PlaybackDecisionTracks } from '../../streaming/PlaybackDecisionFacts'
import { bitrateText, placedReasons } from '../../streaming/playbackDecisionText'
import { FailurePanel, FailureRow } from '../../ui/Failure'
import settingsStyles from '../Settings.module.css'
import styles from './ActiveStreams.module.css'
import type { LiveStreamsStop } from './activeStreamsList'
import { useActiveStreams } from './useActiveStreams'

const LIVE_STOP_MESSAGES = {
  forbidden: 'You no longer have permission to see active streams.',
  failed: 'Live updates stopped. Reload the page to see the latest streams.',
} as const satisfies Record<LiveStreamsStop, string>

/** Every stream that plays on the server now, one row each, kept current as streams change. */
export function ActiveStreams() {
  const { streams, failure, liveStop, retry } = useActiveStreams()

  if (failure && isForbidden(failure))
    return (
      <Alert role="alert">
        Active streams are available to server admins using an account session.
      </Alert>
    )

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1>Active streams</h1>
      </div>
      {liveStop && (
        <Alert role="alert" color="red" mb="md">
          {LIVE_STOP_MESSAGES[liveStop]}
        </Alert>
      )}
      <StreamList streams={streams} failure={failure} onRetry={retry} />
    </>
  )
}

function StreamList({
  streams,
  failure,
  onRetry,
}: Readonly<{
  streams: ReadonlyMap<string, ActiveStreamFieldsFragment> | null
  failure: unknown
  onRetry: () => Promise<void>
}>) {
  if (!streams && failure)
    return (
      <FailurePanel onRetry={onRetry}>
        {requestFailureMessage(failure, "Couldn't load the active streams.")}
      </FailurePanel>
    )
  if (!streams)
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Loading the active streams" />
      </Center>
    )

  return (
    <>
      {failure && (
        <FailureRow className={settingsStyles.failureRow} onRetry={onRetry}>
          {requestFailureMessage(failure, "Couldn't load the latest streams.")}
        </FailureRow>
      )}
      {streams.size === 0 ? (
        <p className={styles.empty}>Nothing is playing right now.</p>
      ) : (
        <div className={styles.list}>
          {[...streams.values()].map((stream) => (
            <StreamRow key={stream.playbackSessionId} stream={stream} />
          ))}
        </div>
      )}
    </>
  )
}

function StreamRow({ stream }: Readonly<{ stream: ActiveStreamFieldsFragment }>) {
  const heading = streamHeading(stream)
  return (
    <article className={styles.row} aria-label={heading}>
      <h2 className={styles.heading}>{heading}</h2>
      <Facts>
        <Fact name="Viewer" value={stream.profile.name ?? 'A deleted Profile'} />
        <Fact name="Device" value={stream.deviceName ?? 'Not named'} />
        <Fact name="Position" value={positionText(stream)} />
        <Fact name="Output bitrate" value={outputBitrateText(stream)} />
        <Fact name="Workers" value={stream.workers.join(', ') || 'None'} />
      </Facts>
      {stream.decision && <StreamDecision decision={stream.decision} />}
    </article>
  )
}

// An active stream carries no requested playback choice, so the reasons name the viewer instead.
function StreamDecision({ decision }: Readonly<{ decision: PlaybackDecisionFieldsFragment }>) {
  const reasons = placedReasons({ decision, requestedChoice: null })
  return (
    <div className={styles.decision}>
      {reasons.stream.length > 0 && (
        <ul className={styles.streamReasons} aria-label="Stream reasons">
          {reasons.stream.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <PlaybackDecisionTracks decision={decision} reasons={reasons} />
    </div>
  )
}

function streamHeading({
  title,
  seriesTitle,
  seasonNumber,
  episodeNumber,
}: ActiveStreamFieldsFragment): string {
  if (!title) return 'A file without a matched title'
  if (!seriesTitle || seasonNumber === null || episodeNumber === null) return title
  return `${seriesTitle} · ${formatEpisodeLabel(seasonNumber, episodeNumber)} · ${title}`
}

function positionText({ positionSeconds, state }: ActiveStreamFieldsFragment): string {
  if (positionSeconds === null || state === null) return 'Preparing'
  const position = formatTimecode({ positionSeconds, durationSeconds: positionSeconds })
  return `${position} · ${state === 'PAUSED' ? 'Paused' : 'Playing'}`
}

// What the stream sends: its video output and, when it has one, its audio output.
function outputBitrateText({ decision }: ActiveStreamFieldsFragment): string {
  const video = decision?.video.output.bitrate
  const audio = decision?.audio ? decision.audio.output.bitrate : 0
  if (video == null || audio === null) return 'Not known'
  return bitrateText(video + audio)
}
