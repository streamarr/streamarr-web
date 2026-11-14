import styles from './UnreadDot.module.css'

/**
 * The dot on the avatar that opens the Profile menu, while an entry inside has a count. It carries
 * no number, and the avatar's accessible name says it instead.
 */
export function UnreadDot() {
  return <span className={styles.dot} data-testid="unread-dot" aria-hidden />
}
