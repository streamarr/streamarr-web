import { useQuery } from '@apollo/client/react'
import { Button, Center, Loader, VisuallyHidden } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  PlaybackReportsDocument,
  type PlaybackReportSummaryFieldsFragment,
} from '../../graphql/generated/graphql'
import { requestFailureMessage } from '../../graphql/requestErrors'
import { FailureRow } from '../../ui/Failure'
import styles from '../Settings.module.css'
import reportStyles from './PlaybackReports.module.css'
import { instantText } from './reportText'
import { useUnreadReportCount } from './unreadReportCount'

/** How many reports one read of the list asks for. */
export const REPORT_PAGE_SIZE = 20

/**
 * The playback reports that viewers shared, newest first, with how many no ServerAdmin has read.
 * Older reports load after the loaded ones on request.
 */
export function PlaybackReports() {
  const { data, previousData, error, refetch, fetchMore } = useQuery(PlaybackReportsDocument, {
    variables: { first: REPORT_PAGE_SIZE },
    fetchPolicy: 'cache-and-network',
  })
  const [older, setOlder] = useState<'idle' | 'loading' | 'failed'>('idle')
  const connection = (data ?? previousData)?.playbackReports

  async function showOlder(after: string | null | undefined) {
    setOlder('loading')
    try {
      await fetchMore({ variables: { after } })
      setOlder('idle')
    } catch {
      setOlder('failed')
    }
  }

  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <h1>Shared reports</h1>
          <UnreadCount />
        </div>
      </div>
      <p className={reportStyles.lede}>
        Reports that viewers shared from the player&apos;s Playback data panel. The server deletes a
        report 30 days after it was shared.
      </p>
      {error && (
        <FailureRow onRetry={refetch}>
          {requestFailureMessage(error, "Couldn't load the shared reports.")}
        </FailureRow>
      )}
      {!connection && !error && (
        <Center h={200}>
          <Loader role="status" aria-label="Loading shared reports" />
        </Center>
      )}
      {connection && (
        <ReportList
          reports={connection.edges.map((edge) => edge.node)}
          hasOlder={connection.pageInfo.hasNextPage}
          loadingOlder={older === 'loading'}
          onShowOlder={() => void showOlder(connection.pageInfo.endCursor)}
        />
      )}
      {older === 'failed' && (
        <FailureRow onRetry={() => showOlder(connection?.pageInfo.endCursor)}>
          Couldn&apos;t load older reports.
        </FailureRow>
      )}
    </>
  )
}

function UnreadCount() {
  const unread = useUnreadReportCount()
  if (unread === null) {
    return null
  }
  return <p className={reportStyles.unread}>{unread} unread</p>
}

function ReportList({
  reports,
  hasOlder,
  loadingOlder,
  onShowOlder,
}: Readonly<{
  reports: readonly PlaybackReportSummaryFieldsFragment[]
  hasOlder: boolean
  loadingOlder: boolean
  onShowOlder: () => void
}>) {
  if (reports.length === 0) {
    return (
      <p className={reportStyles.empty}>
        No shared reports. A viewer shares one from the player&apos;s Playback data panel.
      </p>
    )
  }
  return (
    <>
      <ul className={reportStyles.list} aria-label="Shared reports">
        {reports.map((report) => (
          <li key={report.id}>
            <ReportRow report={report} />
          </li>
        ))}
      </ul>
      {hasOlder && (
        <Button variant="default" mt="md" loading={loadingOlder} onClick={onShowOlder}>
          Show older reports
        </Button>
      )}
    </>
  )
}

function ReportRow({ report }: Readonly<{ report: PlaybackReportSummaryFieldsFragment }>) {
  const unread = report.readAt === null
  return (
    <Link
      to="/settings/server/reports/$reportId"
      params={{ reportId: report.id }}
      className={reportStyles.row}
      data-unread={unread || undefined}
    >
      {unread && (
        <span className={reportStyles.unreadDot}>
          <VisuallyHidden>Unread</VisuallyHidden>
        </span>
      )}
      <strong className={reportStyles.profile}>{report.profileName}</strong>
      <time className={reportStyles.sharedAt} dateTime={report.sharedAt}>
        {instantText(report.sharedAt)}
      </time>
      <span className={reportStyles.notePreview}>{report.note ?? 'No note'}</span>
    </Link>
  )
}
