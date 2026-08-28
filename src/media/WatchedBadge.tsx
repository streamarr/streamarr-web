import type { WatchStatus } from '../graphql/generated/graphql'
import styles from './WatchedBadge.module.css'

export type WatchedBadgeProps = { status: 'watched' } | { status: 'in-progress'; percentComplete: number }

export function badgeFromWatchState(
  watchStatus: WatchStatus,
  percentComplete: number | null,
): WatchedBadgeProps | undefined {
  if (watchStatus === 'WATCHED') {
    return { status: 'watched' }
  }
  if (watchStatus === 'IN_PROGRESS' && percentComplete !== null) {
    return { status: 'in-progress', percentComplete }
  }
  return undefined
}

export function WatchedBadge(props: WatchedBadgeProps) {
  if (props.status === 'watched') {
    return (
      <span className={styles.watchedCheck} aria-label="Watched">
        <CheckGlyph />
      </span>
    )
  }

  return (
    <div className={styles.progressTrack} aria-hidden>
      <div className={styles.progressFill} style={{ width: `${props.percentComplete}%` }} />
    </div>
  )
}

function CheckGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}
