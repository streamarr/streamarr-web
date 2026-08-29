import styles from './ProgressDivider.module.css'

// The watch-progress bar doubles as the section separator, with the count riding it
// (principle 4.2); when nothing has been watched it is simply the separator.
export function ProgressDivider({ watched, total }: { watched: number; total: number }) {
  if (total <= 0) {
    return null
  }
  const percent = (watched / total) * 100
  const label = `${watched} of ${total} watched`

  return (
    <div className={styles.divider}>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={watched}
      >
        <div className={styles.fill} style={{ width: `${percent}%` }} data-testid="progress-fill" />
        {watched > 0 && (
          <span className={styles.marker} style={{ left: `${percent}%` }}>
            {label}
          </span>
        )}
      </div>
    </div>
  )
}
