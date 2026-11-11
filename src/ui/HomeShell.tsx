import type { ReactNode } from 'react'
import styles from './HomeShell.module.css'

// The signed-in ground: an ambient wash, the chrome slot, then the page.
export function HomeShell({
  chrome,
  children,
  ambient = true,
}: Readonly<{
  chrome?: ReactNode
  children: ReactNode
  /** Neutral pages, such as settings, omit the browsing wash. */
  ambient?: boolean
}>) {
  return (
    <div className={styles.homeShell} data-testid="home-shell">
      {ambient && <div className={styles.homeAmbient} aria-hidden />}
      {chrome}
      <main className={styles.homeContent}>{children}</main>
    </div>
  )
}
