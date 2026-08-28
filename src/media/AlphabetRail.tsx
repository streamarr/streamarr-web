import styles from './AlphabetRail.module.css'

// Presentational only: forcing sort to TITLE/ASC on a tap, issuing the seek query, and the
// backward centering fetch are all orchestrated by the caller (LibraryScreen).
export function AlphabetRail({
  index,
  selected,
  onSelect,
}: {
  index: ReadonlyArray<{ letter: string; count: number }>
  selected: string | null
  onSelect: (letter: string | null) => void
}) {
  const visible = index.filter((entry) => entry.count > 0)

  return (
    <nav className={styles.rail} aria-label="Jump to letter">
      {visible.map((entry) => (
        <button
          key={entry.letter}
          type="button"
          className={entry.letter === selected ? `${styles.cell} ${styles.cellSelected}` : styles.cell}
          aria-pressed={entry.letter === selected}
          onClick={() => onSelect(entry.letter === selected ? null : entry.letter)}
        >
          {entry.letter === 'HASH' ? '#' : entry.letter}
        </button>
      ))}
    </nav>
  )
}
