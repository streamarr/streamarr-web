import { useQuery } from '@apollo/client/react'
import { Button, Center, Loader, VisuallyHidden } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import {
  NotificationsDocument,
  type NotificationFieldsFragment,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { useNow } from '../identity/useNow'
import { definedEdges } from '../media/edges'
import settingsStyles from '../styles/settings.module.css'
import { FailurePanel } from '../ui/Failure'
import styles from './Notifications.module.css'
import { fullTime, whenLabel } from './notificationTime'
import { expiryOfWaiting, isOfferRequest, offerRequestState } from './requestState'
import { useMarkShownRead } from './useMarkShownRead'

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
  const shown = query.error ? [] : definedEdges(query.data?.notifications.edges)
  useMarkShownRead(shown[0]?.cursor ?? null)

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

  if (shown.length === 0) {
    return <p className={styles.empty}>No notifications.</p>
  }
  return <NotificationRows notifications={shown.map((edge) => edge.node)} />
}

function NotificationRows({
  notifications,
}: Readonly<{ notifications: NotificationFieldsFragment[] }>) {
  // A waiting Request turns into an expired one when its time runs out, as the server reads it.
  const now = useNow(notifications.map(expiryOfWaiting))
  return (
    <ul className={`${settingsStyles.formPanel} ${styles.rows}`} aria-label="Notifications">
      {notifications.map((notification) => (
        <NotificationRow key={notification.id} notification={notification} now={now} />
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
      {/* A shape, so that unread is not told by colour alone. */}
      {notification.unread ? (
        <span className={styles.unreadMark} data-testid="unread-mark" aria-hidden />
      ) : (
        <span className={styles.markSpace} aria-hidden />
      )}
      <div className={styles.text}>
        {notification.unread && <VisuallyHidden>Unread</VisuallyHidden>}
        {/* The server's line is plain text, so React writes it as text, never as markup. */}
        <p id={lineId} className={styles.line}>
          {notification.message}
        </p>
        <WhenItHappened at={notification.latestEventAt} now={now} />
      </div>
      <RequestAction notification={notification} now={now} lineId={lineId} />
    </li>
  )
}

/**
 * A Request's one action: Review, where it is decided, while it waits, and how it ended once it is
 * over. The decision is made there, so the person sees what anyone who went there directly sees.
 */
function RequestAction({
  notification,
  now,
  lineId,
}: Readonly<{ notification: NotificationFieldsFragment; now: Date; lineId: string }>) {
  if (!isOfferRequest(notification)) return null
  const state = offerRequestState(notification, now)
  if (state.at === 'waiting') {
    return (
      <Button
        component={Link}
        to="/settings/household/offers"
        variant="default"
        aria-describedby={lineId}
      >
        Review
      </Button>
    )
  }
  return state.ending && <span className={styles.ending}>{state.ending}</span>
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
