import { useApolloClient, useQuery } from '@apollo/client/react'
import { Button, Center, Loader, VisuallyHidden } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import {
  NotificationsDocument,
  type NotificationFieldsFragment,
} from '../graphql/generated/graphql'
import { useLiveList } from '../graphql/liveList'
import { requestFailureMessage } from '../graphql/requestErrors'
import { useNow } from '../identity/useNow'
import { definedEdges } from '../media/edges'
import settingsStyles from '../styles/settings.module.css'
import { FailurePanel, FailureRow } from '../ui/Failure'
import { useIntersectionObserver } from '../media/useIntersectionObserver'
import styles from './Notifications.module.css'
import { withNotificationChange, type NotificationEntry } from './notificationList'
import { fullTime, whenLabel } from './notificationTime'
import { expiryOfWaiting, isOfferRequest, offerRequestState } from './requestState'
import { useMarkShownRead } from './useMarkShownRead'
import { useNotificationChanges } from './useNotificationChanges'
import { useOlderNotifications } from './useOlderNotifications'

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
  const { cache } = useApolloClient()
  const live = useLiveList({
    query: NotificationsDocument,
    variables: {},
    keyOf: (entry: NotificationEntry) => entry.notificationId,
    apply: (data, entry: NotificationEntry) => ({
      ...data,
      notifications: withNotificationChange(data.notifications, entry),
    }),
  })
  // One change can touch many Notifications, such as marking them read; the list shows it once.
  useNotificationChanges((entries) => cache.batch({ update: () => entries.forEach(live.receive) }))
  // Notifications arrive and resolve elsewhere, so a visit shows only the server's answer.
  const query = useQuery(NotificationsDocument, {
    fetchPolicy: 'network-only',
    context: live.context,
  })
  // A failed read reports through the query's own error state.
  const readAgain = () => query.refetch().catch(() => undefined)
  const shown = query.error ? [] : definedEdges(query.data?.notifications.edges)
  useMarkShownRead(shown[0]?.cursor ?? null)
  const pageInfo = query.data?.notifications.pageInfo
  const older = useOlderNotifications(pageInfo, live.context)

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

  // A list with older pages has more to show, even when none of what it has loaded shows.
  if (shown.length === 0 && !pageInfo?.hasNextPage) {
    return <p className={styles.empty}>No notifications.</p>
  }
  return (
    <>
      {shown.length > 0 && <NotificationRows notifications={shown.map((edge) => edge.node)} />}
      {older.failure ? (
        <FailureRow className={styles.olderFailure} onRetry={older.load}>
          {requestFailureMessage(older.failure, "Couldn't load older notifications.")}
        </FailureRow>
      ) : (
        pageInfo?.hasNextPage && <EndOfTheList key={pageInfo.endCursor} onReached={older.load} />
      )}
    </>
  )
}

/**
 * Where the loaded list ends, which asks for the next older page as it comes near the view. Each
 * end is a new element, so an end that is already in view when a page arrives asks again.
 */
function EndOfTheList({ onReached }: Readonly<{ onReached: () => void }>) {
  const end = useIntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onReached()
    },
    { rootMargin: '0px 0px 50% 0px' },
  )
  return <div ref={end} className={styles.end} data-testid="older-notifications" aria-hidden />
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
