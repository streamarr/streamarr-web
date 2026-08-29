import { useState } from 'react'
import { CheckGlyph, ChevronDownGlyph } from './glyphs'
import styles from './SeasonSideRail.module.css'

// Long-running shows reach 37+ seasons; the rail shows a handful and a chevron reveals the rest.
const VISIBLE_ROWS = 5

export interface SeasonRailEntry {
  id: string
  label: string
  unwatchedCount: number
}

export function SeasonSideRail({
  seasons,
  selectedId,
  onSelect,
}: {
  seasons: SeasonRailEntry[]
  selectedId: string
  onSelect: (seasonId: string) => void
}) {
  const selectedIndex = seasons.findIndex((season) => season.id === selectedId)
  const [expanded, setExpanded] = useState(selectedIndex >= VISIBLE_ROWS)
  const visible = expanded ? seasons : seasons.slice(0, VISIBLE_ROWS)

  return (
    <nav className={styles.rail} aria-label="Seasons">
      <div className={styles.eyebrow}>Seasons · {seasons.length}</div>
      <div className={styles.rows}>
        {visible.map((season) => {
          const selected = season.id === selectedId
          return (
            <button
              key={season.id}
              type="button"
              className={selected ? `${styles.row} ${styles.selected}` : styles.row}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(season.id)}
            >
              <span>{season.label}</span>
              {season.unwatchedCount === 0 ? (
                <span className={styles.check} aria-label="Watched">
                  <CheckGlyph size={11} />
                </span>
              ) : (
                <span className={styles.count}>{season.unwatchedCount}</span>
              )}
            </button>
          )
        })}
        {visible.length < seasons.length && (
          <button
            type="button"
            className={styles.more}
            aria-label={`Show all ${seasons.length} seasons`}
            onClick={() => setExpanded(true)}
          >
            <ChevronDownGlyph />
          </button>
        )}
      </div>
    </nav>
  )
}
