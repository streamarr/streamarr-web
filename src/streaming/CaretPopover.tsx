import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from 'react'
import { Icon } from '../ui/Icon'
import styles from './CaretPopover.module.css'

// The surface scrolls its rows rather than rise closer than this to the top of the screen.
const SCREEN_EDGE_GAP_PX = 16

const ROW_MOVES = new Map<string, (index: number, count: number) => number>([
  ['ArrowDown', (index, count) => (index + 1) % count],
  ['ArrowUp', (index, count) => (index - 1 + count) % count],
  ['Home', () => 0],
  ['End', (_index, count) => count - 1],
])

export interface PopoverOption<Id> {
  id: Id
  label: string
}

/**
 * A menu of options above the control bar, its caret pointing down at the anchor that opened it.
 * Focus starts on the chosen row, and moves there, or else to the nearest row, when the focused row
 * goes. Choosing, Escape or Shift+Tab returns focus to the anchor. A press or focus outside the
 * menu and its anchor dismisses it.
 */
export function CaretPopover<Id>({
  id,
  heading,
  anchorRef,
  options,
  selected,
  onChoose,
  onDismiss,
}: Readonly<{
  id: string
  heading: string
  anchorRef: RefObject<HTMLElement | null>
  options: readonly PopoverOption<Id>[]
  selected: Id | null
  onChoose: (id: Id) => void
  onDismiss: () => void
}>) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const focusedRow = useRef<{ row: HTMLElement; index: number } | null>(null)
  const headingId = useId()

  useLayoutEffect(() => {
    const place = () => placeAbove(surfaceRef.current, anchorRef.current)
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorRef])

  useEffect(() => {
    focusCheckedOrNearestRow(menuRef.current, 0)
  }, [])

  // Removing the focused row drops focus to the body without a focusin, so nothing else notices.
  useEffect(() => {
    const lost = focusedRow.current
    if (!lost || lost.row.isConnected) {
      return
    }
    focusCheckedOrNearestRow(menuRef.current, lost.index)
  })

  useEffect(() => {
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node) ||
      !(surfaceRef.current?.contains(target) || anchorRef.current?.contains(target))
    function dismissFromOutside(event: Event) {
      if (outside(event.target)) {
        onDismiss()
      }
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }
      anchorRef.current?.focus()
      onDismiss()
    }
    document.addEventListener('pointerdown', dismissFromOutside)
    document.addEventListener('focusin', dismissFromOutside)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissFromOutside)
      document.removeEventListener('focusin', dismissFromOutside)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [anchorRef, onDismiss])

  function choose(option: Id) {
    anchorRef.current?.focus()
    onChoose(option)
  }

  function handleRowKey(event: ReactKeyboardEvent<HTMLElement>) {
    // Shift+Tab lands on the anchor, which the outside checks count as part of the menu.
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault()
      anchorRef.current?.focus()
      onDismiss()
      return
    }
    moveBetweenRows(event)
  }

  return (
    <div ref={surfaceRef} className={styles.popover}>
      <div id={headingId} className={styles.heading}>
        {heading}
      </div>
      <div ref={menuRef} id={id} role="menu" aria-labelledby={headingId} className={styles.menu}>
        {options.map((option, index) => {
          const checked = option.id === selected
          return (
            <button
              key={String(option.id)}
              type="button"
              role="menuitemradio"
              aria-checked={checked}
              tabIndex={-1}
              className={styles.row}
              onClick={() => choose(option.id)}
              onFocus={(event) => {
                focusedRow.current = { row: event.currentTarget, index }
              }}
              onKeyDown={handleRowKey}
            >
              {option.label}
              {checked && <Icon name="check" size={14} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function rowsOf(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])
}

function focusCheckedOrNearestRow(menu: HTMLElement | null, index: number) {
  const rows = rowsOf(menu)
  const checked = rows.find((row) => row.getAttribute('aria-checked') === 'true')
  const target = checked ?? rows.at(Math.min(index, rows.length - 1))
  target?.focus()
}

function moveBetweenRows(event: ReactKeyboardEvent<HTMLElement>) {
  const move = ROW_MOVES.get(event.key)
  if (!move) {
    return
  }
  event.preventDefault()
  const rows = rowsOf(event.currentTarget.parentElement)
  rows[move(rows.indexOf(event.currentTarget), rows.length)]?.focus()
}

function placeAbove(surface: HTMLElement | null, anchor: HTMLElement | null) {
  const frame = surface?.offsetParent
  if (!surface || !anchor || !frame) {
    return
  }
  const anchorBox = anchor.getBoundingClientRect()
  const frameLeft = frame.getBoundingClientRect().left + frame.clientLeft
  const caretX = anchorBox.left + anchorBox.width / 2 - frameLeft
  const furthestLeft = frame.clientWidth - surface.offsetWidth
  const left = Math.min(Math.max(caretX - surface.offsetWidth / 2, 0), furthestLeft)
  surface.style.left = `${left}px`
  surface.style.setProperty('--caret-left', `${caretX - left - surface.clientLeft}px`)
  surface.style.maxHeight = `${surface.getBoundingClientRect().bottom - SCREEN_EDGE_GAP_PX}px`
}
