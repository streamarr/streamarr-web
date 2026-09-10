import { useEffect, useId, useRef, useState } from 'react'
import type { MediaSort, OrderMediaBy, SortDirection } from '../graphql/generated/graphql'
import styles from './SortMenu.module.css'

// One fixed direction per field (matches the mock's single "Sort ▾" chip, no separate ASC/DESC
// toggle) — a rail letter tap overrides `by`/`direction` to TITLE/ASC regardless of this list.
const SORT_OPTIONS: { by: OrderMediaBy; direction: SortDirection; label: string }[] = [
  { by: 'ADDED', direction: 'DESC', label: 'Recently added' },
  { by: 'TITLE', direction: 'ASC', label: 'Title' },
  { by: 'RELEASE_DATE', direction: 'DESC', label: 'Release date' },
  { by: 'RUNTIME', direction: 'ASC', label: 'Runtime' },
  { by: 'LAST_WATCHED', direction: 'DESC', label: 'Last watched' },
]

export function SortMenu({ sort, onChange }: { sort: MediaSort; onChange: (sort: MediaSort) => void }) {
  const [opened, setOpened] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const current = SORT_OPTIONS.find((option) => option.by === sort.by) ?? SORT_OPTIONS[0]

  useEffect(() => {
    if (!opened) {
      return
    }
    function onPointerDown(event: MouseEvent) {
      if (anchor.current && !anchor.current.contains(event.target as Node)) {
        setOpened(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpened(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [opened])

  return (
    <div className={styles.anchor} ref={anchor}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={opened}
        aria-controls={opened ? menuId : undefined}
        onClick={() => setOpened((value) => !value)}
      >
        Sort: {current.label}
      </button>
      {opened && (
        <div id={menuId} className={styles.menu} role="menu">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.by}
              type="button"
              role="menuitemradio"
              aria-checked={option.by === sort.by}
              className={option.by === sort.by ? `${styles.item} ${styles.itemActive}` : styles.item}
              onClick={() => {
                onChange({ by: option.by, direction: option.direction })
                setOpened(false)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
