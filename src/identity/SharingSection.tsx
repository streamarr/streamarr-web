import { Alert } from '@mantine/core'
import { useId, type ReactNode, type Ref } from 'react'
import settingsStyles from '../styles/settings.module.css'
import styles from './Sharing.module.css'

/** One panel of the page: its title names the region, and a refusal shows under the title. */
export function SharingSection({
  title,
  failure,
  heading,
  children,
}: Readonly<{
  title: string
  failure: string | null
  /** Receives the title, which can then take focus from script but stays out of the Tab order. */
  heading?: Ref<HTMLHeadingElement>
  children: ReactNode
}>) {
  const titleId = useId()
  return (
    <section className={`${settingsStyles.formPanel} ${styles.section}`} aria-labelledby={titleId}>
      <h2
        ref={heading}
        id={titleId}
        className={styles.sectionTitle}
        tabIndex={heading ? -1 : undefined}
      >
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
