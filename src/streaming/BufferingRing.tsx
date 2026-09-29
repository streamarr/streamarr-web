import styles from './BufferingRing.module.css'

/** Shows that playback is waiting for data, turning over the middle of the video. */
export function BufferingRing() {
  return (
    <div className={styles.ring}>
      <progress className={styles.status} aria-label="Buffering" />
      <svg className={styles.spinner} viewBox="0 0 24 24" aria-hidden="true">
        <circle className={styles.track} cx="12" cy="12" r="9" />
        <circle
          className={styles.arc}
          cx="12"
          cy="12"
          r="9"
          pathLength={4}
          strokeDasharray="1 3"
          transform="rotate(-90 12 12)"
        />
      </svg>
    </div>
  )
}
