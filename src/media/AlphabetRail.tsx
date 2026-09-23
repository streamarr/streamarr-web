import { useEffect, useRef } from 'react'
import styles from './AlphabetRail.module.css'

// Presentational only: forcing sort to TITLE/ASC on a tap, issuing the seek query, and the
// backward centering fetch are all orchestrated by the caller (LibraryScreen).
export type SelectionInput = 'keyboard' | 'pointer'

export function AlphabetRail({
  index,
  selected,
  onSelect,
}: Readonly<{
  index: ReadonlyArray<{ letter: string; count: number }>
  selected: string | null
  onSelect: (letter: string | null, input: SelectionInput) => void
}>) {
  const visible = index.filter((entry) => entry.count > 0)
  const selectedCell = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    selectedCell.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selected])

  return (
    <nav className={styles.rail} aria-label="Jump to letter">
      {visible.map((entry) => (
        <button
          key={entry.letter}
          ref={entry.letter === selected ? selectedCell : undefined}
          type="button"
          className={
            entry.letter === selected ? `${styles.cell} ${styles.cellSelected}` : styles.cell
          }
          aria-pressed={entry.letter === selected}
          onClick={(event) =>
            onSelect(
              entry.letter === selected ? null : entry.letter,
              // A click a key activated carries no click count.
              event.detail === 0 ? 'keyboard' : 'pointer',
            )
          }
        >
          {entry.letter === 'HASH' ? '#' : entry.letter}
        </button>
      ))}
    </nav>
  )
}
