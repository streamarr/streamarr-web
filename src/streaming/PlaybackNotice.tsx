import styles from './PlaybackNotice.module.css'

/**
 * The short text over the video after a fallback. The region stays in the page while empty, so
 * assistive technology announces each text once, politely, when it appears.
 */
export function PlaybackNotice({
  notice,
}: Readonly<{ notice: { text: string; serial: number } | null }>) {
  return (
    <output className={styles.region}>
      {notice && (
        <span key={notice.serial} className={styles.notice}>
          {notice.text}
        </span>
      )}
    </output>
  )
}
