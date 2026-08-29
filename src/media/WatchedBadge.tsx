import type { WatchStatus } from '../graphql/generated/graphql'
import { CheckGlyph } from './glyphs'
import styles from './WatchedBadge.module.css'

export type WatchedBadgeProps =
  | { status: 'watched' }
  | { status: 'in-progress'; percentComplete: number }
  | { status: 'unwatched-count'; count: number }

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

  // Season and series posters count what is left rather than showing a percentage (principle 6).
  if (props.status === 'unwatched-count') {
    return (
      <span className={styles.countBadge} aria-label={`${props.count} unwatched`}>
        {props.count}
      </span>
    )
  }

  return (
    <div className={styles.progressTrack} aria-hidden>
      <div className={styles.progressFill} style={{ width: `${props.percentComplete}%` }} />
    </div>
  )
}
