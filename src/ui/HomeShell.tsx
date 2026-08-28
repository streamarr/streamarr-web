import type { ReactNode } from 'react'
import styles from './HomeShell.module.css'

// The signed-in ground: an ambient wash, the chrome slot, then the page.
export function HomeShell({ chrome, children }: { chrome?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.homeShell}>
      <div className={styles.homeAmbient} aria-hidden />
      {chrome}
      <main className={styles.homeContent}>{children}</main>
    </div>
  )
}
