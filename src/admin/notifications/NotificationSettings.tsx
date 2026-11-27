import styles from '../../styles/settings.module.css'
import { PageNotice } from '../../ui/PageNotice'
import { usePageNotice } from '../../ui/usePageNotice'
import { NotificationRetention } from './NotificationRetentionSettings'

/** How long the server keeps Notifications, which a ServerAdmin sets. */
export function NotificationSettings() {
  const { notice, count, announce, dismiss } = usePageNotice()

  return (
    <>
      <div className={styles.pageHeading}>
        <h1>Notifications</h1>
      </div>
      <PageNotice count={count} onDismiss={dismiss}>
        {notice}
      </PageNotice>
      <div className={styles.formPanel}>
        {/* A save leaves the page as it was, so its notice keeps focus where the admin is. */}
        <NotificationRetention onSaved={(text) => announce(text, { inPlace: true })} />
      </div>
    </>
  )
}
