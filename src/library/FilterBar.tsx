import styles from './FilterBar.module.css'

export type WatchStatusFilter = 'ALL' | 'UNWATCHED' | 'IN_PROGRESS'

const CHIPS: { value: WatchStatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'UNWATCHED', label: 'Unwatched' },
  { value: 'IN_PROGRESS', label: 'In progress' },
]

export function FilterBar({
  status,
  onChange,
  showing,
}: {
  status: WatchStatusFilter
  onChange: (status: WatchStatusFilter) => void
  showing: string
}) {
  return (
    <div className={styles.filterBar}>
      <div className={styles.chips}>
        {CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className={chip.value === status ? `${styles.chip} ${styles.chipActive}` : styles.chip}
            aria-pressed={chip.value === status}
            onClick={() => onChange(chip.value)}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <span className={styles.showing}>{showing}</span>
    </div>
  )
}
