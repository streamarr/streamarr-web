import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Icon } from '../ui/Icon'
import styles from './CaretPopover.module.css'

// The surface scrolls its rows rather than rise closer than this to the top of the screen.
const SCREEN_EDGE_GAP_PX = 16
// A caution's explanation is at most this wide, and sits this far from the surface.
const EXPLANATION_MAX_WIDTH_PX = 240
const EXPLANATION_GAP_PX = 8

const ROW_MOVES = new Map<string, (index: number, count: number) => number>([
  ['ArrowDown', (index, count) => (index + 1) % count],
  ['ArrowUp', (index, count) => (index - 1 + count) % count],
  ['Home', () => 0],
  ['End', (_index, count) => count - 1],
])

export interface PopoverOption<Id> {
  id: Id
  label: string
  /**
   * Why the option asks for the viewer's attention. A mark after the label carries it as its
   * accessible name, and the explanation shows beside the menu while the pointer hovers the row,
   * while focus is on it, or after a tap on the mark.
   */
  caution?: string
}

// Which row's caution shows: the hovered row first, then a tapped mark, then the focused row.
// Focus moving to a row clears the other two.
interface ExplainedRows {
  hovered: number | null
  tapped: number | null
  focused: number | null
}

const NO_EXPLAINED_ROWS: ExplainedRows = { hovered: null, tapped: null, focused: null }

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
  const explanationRef = useRef<HTMLDivElement>(null)
  const markTouched = useRef(false)
  const [explainedRows, setExplainedRows] = useState(NO_EXPLAINED_ROWS)
  const explainedIndex = explainedRows.hovered ?? explainedRows.tapped ?? explainedRows.focused
  const explanation = explainedIndex === null ? undefined : options[explainedIndex]?.caution
  const headingId = useId()

  // The explanation's side depends on where the surface lands, so both move together.
  useLayoutEffect(() => {
    const place = () => {
      placeAbove(surfaceRef.current, anchorRef.current)
      placeExplanation({
        explanation: explanationRef.current,
        row: explainedIndex === null ? undefined : rowsOf(menuRef.current)[explainedIndex],
        surface: surfaceRef.current,
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorRef, explainedIndex, explanation])

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

  // Moving focus supersedes whatever the pointer last explained, even where it still rests.
  function explainFocused(index: number) {
    setExplainedRows({ hovered: null, tapped: null, focused: index })
  }

  function explainHovered(index: number) {
    setExplainedRows((rows) => ({ ...rows, hovered: index }))
  }

  function stopHovering(index: number) {
    setExplainedRows((rows) => (rows.hovered === index ? { ...rows, hovered: null } : rows))
  }

  // A tap on the mark explains it rather than choosing the row; a mouse click chooses as usual.
  function tapMark(event: ReactMouseEvent<HTMLElement>, index: number) {
    if (!markTouched.current) {
      return
    }
    event.stopPropagation()
    setExplainedRows((rows) => ({ ...rows, tapped: rows.tapped === index ? null : index }))
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
              aria-label={cautionedName(option)}
              tabIndex={-1}
              className={styles.row}
              onClick={() => choose(option.id)}
              onFocus={(event) => {
                focusedRow.current = { row: event.currentTarget, index }
                explainFocused(index)
              }}
              onPointerEnter={() => explainHovered(index)}
              onPointerLeave={() => stopHovering(index)}
              onKeyDown={handleRowKey}
            >
              <span className={styles.label}>
                {option.label}
                {option.caution && (
                  <span
                    className={styles.caution}
                    onPointerDown={(event) => {
                      markTouched.current = event.pointerType === 'touch'
                    }}
                    onClick={(event) => tapMark(event, index)}
                  >
                    <Icon name="alert" size={14} label={option.caution} />
                  </span>
                )}
              </span>
              {checked && <Icon name="check" size={14} />}
            </button>
          )
        })}
      </div>
      {explanation && (
        <div ref={explanationRef} className={styles.explanation} aria-hidden="true">
          {explanation}
        </div>
      )}
    </div>
  )
}

// A row's name from its content would join the label and the mark's name with no space between
// them, so a cautioned row names both itself, with a sentence break.
function cautionedName<Id>({ label, caution }: PopoverOption<Id>): string | undefined {
  return caution && `${label}. ${caution}`
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

// Level with its row on the side away from the screen edge, beside the menu so it covers no
// other row, or above the menu where the screen leaves no room beside it.
function placeExplanation({
  explanation,
  row,
  surface,
}: {
  explanation: HTMLElement | null
  row: HTMLElement | undefined
  surface: HTMLElement | null
}) {
  if (!explanation || !row || !surface) {
    return
  }
  if (surface.offsetLeft < EXPLANATION_MAX_WIDTH_PX + EXPLANATION_GAP_PX) {
    explanation.dataset.side = 'above'
    explanation.style.top = ''
    return
  }
  explanation.dataset.side = 'start'
  explanation.style.top = `${row.offsetTop - (row.parentElement?.scrollTop ?? 0)}px`
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
