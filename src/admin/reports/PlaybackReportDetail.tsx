import { useApolloClient, useMutation, useQuery } from '@apollo/client/react'
import { Center, Loader } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import {
  MarkPlaybackReportReadDocument,
  PlaybackReportDocument,
  type PlaybackReportQuery,
  type VideoQuality,
} from '../../graphql/generated/graphql'
import { requestFailureMessage } from '../../graphql/requestErrors'
import { FactList, PlaybackDecisionTracks } from '../../streaming/PlaybackDecisionFacts'
import { placedReasons } from '../../streaming/playbackDecisionText'
import { playerFigureFacts, screenFigureFacts } from '../../streaming/playerFigures'
import { qualityLabel } from '../../streaming/qualityChoices'
import { FailureRow } from '../../ui/Failure'
import { Icon } from '../../ui/Icon'
import styles from '../Settings.module.css'
import reportStyles from './PlaybackReports.module.css'
import {
  audioEntryText,
  audioOutputText,
  displayText,
  instantText,
  videoEntryText,
} from './reportText'
import { readUnreadReportCountAgain } from './unreadReportCount'

type Report = NonNullable<PlaybackReportQuery['playbackReport']>

/**
 * One shared playback report: the viewer's note and the Playback data panel as it stood when the
 * viewer shared it. Opening an unread report marks it read.
 */
export function PlaybackReportDetail({ reportId }: Readonly<{ reportId: string }>) {
  const { data, error, refetch } = useQuery(PlaybackReportDocument, {
    variables: { id: reportId },
    fetchPolicy: 'cache-and-network',
    // A retry merges into the cached report, whose first read time it may not undo.
    refetchWritePolicy: 'merge',
  })
  const report = data?.playbackReport
  useMarkReadOnOpen(report)
  return (
    <>
      <Link to="/settings/server/reports" className={reportStyles.back}>
        <Icon name="arrow-left" />
        Back to shared reports
      </Link>
      {error && (
        <FailureRow onRetry={refetch}>
          {requestFailureMessage(error, "Couldn't load the report.")}
        </FailureRow>
      )}
      <ReportContent report={report} loading={!data && !error} />
    </>
  )
}

function ReportContent({
  report,
  loading,
}: Readonly<{ report: Report | null | undefined; loading: boolean }>) {
  if (loading) {
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Loading the report" />
      </Center>
    )
  }
  if (report === null) {
    return (
      <p className={reportStyles.empty}>
        This report no longer exists. The server deletes a report 30 days after it was shared.
      </p>
    )
  }
  if (!report) {
    return null
  }
  return <ReportSnapshot report={report} />
}

// Marks the report read once, the first time it is shown unread; the server keeps the first read
// time. The unread count reads again once the server answers.
function useMarkReadOnOpen(report: Report | null | undefined) {
  const client = useApolloClient()
  const [markRead] = useMutation(MarkPlaybackReportReadDocument)
  const marked = useRef<string | null>(null)
  const unreadId = report && report.readAt === null ? report.id : null
  useEffect(() => {
    if (unreadId === null || marked.current === unreadId) {
      return
    }
    marked.current = unreadId
    markRead({ variables: { input: { playbackReportId: unreadId } } })
      .then(() => readUnreadReportCountAgain(client))
      // A report left unread stays in the unread count, which shows the outcome.
      .catch(() => undefined)
  }, [unreadId, markRead, client])
}

function ReportSnapshot({ report }: Readonly<{ report: Report }>) {
  const headingId = useId()
  return (
    <article className={reportStyles.report} aria-labelledby={headingId}>
      <div className={styles.pageHeading}>
        <h1 id={headingId}>Report from {report.profileName}</h1>
      </div>
      <dl className={reportStyles.meta}>
        <dt>Shared</dt>
        <dd>
          <time dateTime={report.sharedAt}>{instantText(report.sharedAt)}</time>
        </dd>
        {report.readAt && (
          <>
            <dt>First read</dt>
            <dd>
              <time dateTime={report.readAt}>{instantText(report.readAt)}</time>
            </dd>
          </>
        )}
      </dl>
      {report.note ? (
        <blockquote className={reportStyles.note}>{report.note}</blockquote>
      ) : (
        <p className={reportStyles.noNote}>No note</p>
      )}
      <p className={reportStyles.choice}>
        Playback choice: {choiceText(report.requestedChoice)}, played as{' '}
        {choiceText(report.playbackChoice)}
      </p>
      <div className={reportStyles.columns}>
        <Section name="Server">
          {report.decisions.map((decision) => (
            <DecisionAttempt
              key={decision.streamSessionId}
              decision={decision}
              report={report}
              numbered={report.decisions.length > 1}
            />
          ))}
        </Section>
        <div>
          <Section name="Player">
            <FactList facts={playerFigureFacts(report.player)} />
          </Section>
          <DeviceSections player={report.player} />
        </div>
      </div>
      <Section name="Device capabilities">
        <ul className={reportStyles.capabilities}>
          {report.capabilityDeclaration.video.map((entry, index) => (
            <li key={`video-${index}`}>{videoEntryText(entry)}</li>
          ))}
          {report.capabilityDeclaration.audio.map((entry, index) => (
            <li key={`audio-${index}`}>{audioEntryText(entry)}</li>
          ))}
        </ul>
      </Section>
    </article>
  )
}

// A web client reports its screen and browser, a TV client its display mode and audio output.
function DeviceSections({ player }: Readonly<{ player: Report['player'] }>) {
  const { screen, browser, display, audioOutput } = player
  const tv: Record<string, string> = {}
  if (display) {
    tv.Display = displayText(display)
  }
  if (audioOutput) {
    tv['Audio output'] = audioOutputText(audioOutput)
  }
  return (
    <>
      {(screen || browser) && (
        <Section name="This screen">
          <FactList facts={screenFigureFacts({ screen, browser })} />
        </Section>
      )}
      {Object.keys(tv).length > 0 && (
        <Section name="This TV">
          <FactList facts={tv} />
        </Section>
      )}
    </>
  )
}

function DecisionAttempt({
  decision,
  report,
  numbered,
}: Readonly<{ decision: Report['decisions'][number]; report: Report; numbered: boolean }>) {
  const reasons = placedReasons({ decision, requestedChoice: report.requestedChoice })
  return (
    <div className={reportStyles.attempt}>
      {numbered && (
        <h3 className={reportStyles.attemptHeading}>
          Format attempt {decision.formatAttempt}
          {decision.streamSessionId === report.streamSessionId && ' · the player’s figures'}
        </h3>
      )}
      <StreamReasons reasons={reasons.stream} />
      <PlaybackDecisionTracks decision={decision} reasons={reasons} />
    </div>
  )
}

function StreamReasons({ reasons }: Readonly<{ reasons: string[] }>) {
  if (reasons.length === 0) {
    return null
  }
  return <p className={reportStyles.streamReason}>{reasons.join(' ')}</p>
}

function Section({ name, children }: Readonly<{ name: string; children: ReactNode }>) {
  const headingId = useId()
  return (
    <section className={reportStyles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={reportStyles.sectionHeading}>
        {name}
      </h2>
      {children}
    </section>
  )
}

function choiceText(choice: VideoQuality): string {
  return qualityLabel(choice) ?? choice
}
