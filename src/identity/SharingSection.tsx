import { Alert } from '@mantine/core'
import { useId, type ReactNode } from 'react'
import settingsStyles from '../styles/settings.module.css'
import styles from './Sharing.module.css'

/** One panel of the page: its title names the region, and a refusal shows under the title. */
export function SharingSection({
  title,
  failure,
  children,
}: Readonly<{ title: string; failure: string | null; children: ReactNode }>) {
  const titleId = useId()
  return (
    <section className={`${settingsStyles.formPanel} ${styles.section}`} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.sectionTitle}>
        {title}
      </h2>
      {failure && (
        <Alert color="red" role="alert">
          {failure}
        </Alert>
      )}
      {children}
    </section>
  )
}
