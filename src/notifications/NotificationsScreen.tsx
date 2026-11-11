import { useQuery } from '@apollo/client/react'
import { Center, Loader, VisuallyHidden } from '@mantine/core'
import { useId } from 'react'
import {
  NotificationsDocument,
  type NotificationFieldsFragment,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { definedEdges } from '../media/edges'
import settingsStyles from '../styles/settings.module.css'
import { FailurePanel } from '../ui/Failure'
import styles from './Notifications.module.css'
import { fullTime, whenLabel } from './notificationTime'

/** The Account's Notifications, newest first, each in the server's words. */
export function NotificationsScreen() {
  return (
    <div className={`${settingsStyles.settings} ${styles.page}`}>
      <div className={settingsStyles.pageHeading}>
        <h1>Notifications</h1>
      </div>
      <NotificationsList />
    </div>
  )
}

function NotificationsList() {
  // Notifications arrive and resolve elsewhere, so a visit shows only the server's answer.
  const query = useQuery(NotificationsDocument, { fetchPolicy: 'network-only' })
  // A failed read reports through the query's own error state.
  const readAgain = () => query.refetch().catch(() => undefined)

  if (query.loading && !query.data) {
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Loading notifications" />
      </Center>
    )
  }
  if (query.error || !query.data) {
    return (
      <FailurePanel onRetry={readAgain}>
        {requestFailureMessage(query.error, "Couldn't load notifications.")}
      </FailurePanel>
    )
  }

  const shown = definedEdges(query.data.notifications.edges)
  if (shown.length === 0) {
    return <p className={styles.empty}>No notifications.</p>
  }
  const now = new Date()
  return (
    <ul className={`${settingsStyles.formPanel} ${styles.rows}`} aria-label="Notifications">
      {shown.map(({ node }) => (
        <NotificationRow key={node.id} notification={node} now={now} />
      ))}
    </ul>
  )
}

function NotificationRow({
  notification,
  now,
}: Readonly<{ notification: NotificationFieldsFragment; now: Date }>) {
  const lineId = useId()
  return (
    <li className={styles.row}>
      <div className={styles.text}>
        {/* The server's line is plain text, so React writes it as text, never as markup. */}
        <p id={lineId} className={styles.line}>
          {notification.message}
        </p>
        <WhenItHappened at={notification.latestEventAt} now={now} />
      </div>
    </li>
  )
}

/** How long ago for the eye, and the whole time for a screen reader. */
function WhenItHappened({ at, now }: Readonly<{ at: string; now: Date }>) {
  return (
    <time className={styles.time} dateTime={at}>
      <span aria-hidden>{whenLabel(at, now)}</span>
      <VisuallyHidden>{fullTime(at)}</VisuallyHidden>
    </time>
  )
}
