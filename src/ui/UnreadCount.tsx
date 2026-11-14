import styles from './UnreadCount.module.css'

/**
 * The count after a Profile menu entry's label, as `countText` reads it. The entry's accessible
 * name carries the count in words, so the number itself is hidden from assistive technology.
 */
export function UnreadCount({ text }: Readonly<{ text: string }>) {
  return (
    <span className={styles.count} aria-hidden>
      {text}
    </span>
  )
}
