import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Icon } from './Icon'
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
  /**
   * The menu's message explains the caution instead: the mark shows without an explanation of its
   * own, and the row's name is its label alone.
   */
  explainedByMessage?: boolean
  /** A hairline above the row sets it, and the rows after it, apart from the rows before. */
  divided?: boolean
}

/**
 * A row after the options that turns one setting on or off. While it is unavailable, it shows its
 * state, changes nothing, and explains why as a caution does, without the mark.
 */
export interface PopoverToggle {
  label: string
  checked: boolean
  unavailable?: string
  onToggle: () => void
}

// The caution in the heading keeps its own name, because a row's index moves as options come and go.
const HEADING = 'heading'
type Explained = number | typeof HEADING

// Which caution shows: the hovered row first, then a tapped mark, then the focused row. The caution
// in the heading counts as a row here. Focus moving to a row clears the other two.
interface ExplainedRows {
  hovered: Explained | null
  tapped: Explained | null
  focused: Explained | null
}

const NO_EXPLAINED_ROWS: ExplainedRows = { hovered: null, tapped: null, focused: null }

type Side = 'above' | 'below'

/**
 * A menu of options above the anchor that opened it, its caret pointing down at the anchor, or
 * below the anchor with the caret pointing up. A menu placed below opens above instead where the
 * screen ends too close under the anchor to show a row and leaves more room above it. A `message`
 * puts a caution symbol in the heading, and is the menu's description. The message shows as a
 * row's explanation does: while the pointer hovers the symbol, while focus is on it, or after a tap
 * on it. Focus starts on the chosen row, and moves there, or else to the nearest row, when the
 * focused row goes. Shift+Tab from a row moves focus to the heading's symbol, and Tab moves it back.
 * Choosing, Escape, or Shift+Tab from the heading's symbol or else from a row, returns focus to the
 * anchor. A press or focus outside the menu and its anchor dismisses it.
 */
export function CaretPopover<Id>({
  id,
  heading,
  anchorRef,
  options,
  selected,
  message,
  toggle,
  onChoose,
  onDismiss,
  placement = 'above',
}: Readonly<{
  id: string
  heading: string
  anchorRef: RefObject<HTMLElement | null>
  options: readonly PopoverOption<Id>[]
  selected: Id | null
  message?: string
  toggle?: PopoverToggle
  onChoose: (id: Id) => void
  onDismiss: () => void
  placement?: Side
}>) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLDivElement>(null)
  const headingCautionRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const focusedRow = useRef<{ row: HTMLElement; index: number } | null>(null)
  const explanationRef = useRef<HTMLDivElement>(null)
  const pressedByTouch = useRef(false)
  const [explainedRows, setExplainedRows] = useState(NO_EXPLAINED_ROWS)
  const explainedIndex = explainedRows.hovered ?? explainedRows.tapped ?? explainedRows.focused
  const explanations = [...options.map(ownExplanation), toggle?.unavailable]
  const explanation = explanationOf({ explained: explainedIndex, explanations, message })
  // The menu keeps room for its longest explanation from the start, so no explanation that
  // shows or goes moves a row: a row moving under the pointer would end its own hover.
  const longestCaution = longestOf([...explanations, message])
  const reservedRoom = useRef(0)
  const headingId = useId()
  const messageId = useId()

  // The explanation's side depends on where the surface lands, so both move together. The height
  // limit is written once, at its final value: an interim taller limit would clamp the rows'
  // scroll position, and the shorter one would not restore it.
  useLayoutEffect(() => {
    const place = () => {
      const surface = surfaceRef.current
      alignToAnchor(surface, anchorRef.current)
      reservedRoom.current = placeExplanation({
        explanation: explanationRef.current,
        line: explainedLine({
          explained: explainedIndex,
          heading: headingRef.current,
          menu: menuRef.current,
        }),
        surface,
        reservedRoom: reservedRoom.current,
      })
      limitHeight({
        surface,
        firstRow: rowsOf(menuRef.current)[0],
        roomAbove: reservedRoom.current,
        placement,
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorRef, explainedIndex, explanation, placement])

  useEffect(() => {
    focusCheckedOrNearestRow(menuRef.current, 0)
  }, [])

  // Removing the focused row drops focus to the body without a focusin, so nothing else notices.
  // The viewer did not move focus, so the pointer on the heading's caution keeps its message.
  useEffect(() => {
    const lost = focusedRow.current
    if (!lost || lost.row.isConnected) {
      return
    }
    focusCheckedOrNearestRow(menuRef.current, lost.index)
    if (explainedRows.hovered === HEADING) {
      explainHovered(HEADING)
    }
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

  function returnToAnchor() {
    anchorRef.current?.focus()
    onDismiss()
  }

  // An unavailable toggle explains itself on any press rather than change.
  function pressToggle({ unavailable, onToggle }: PopoverToggle, index: number) {
    if (unavailable) {
      tapMark(index)
      return
    }
    anchorRef.current?.focus()
    onToggle()
  }

  function focusRow(row: HTMLElement, index: number) {
    focusedRow.current = { row, index }
    explainFocused(index)
  }

  // Moving focus supersedes whatever the pointer last explained, even where it still rests.
  function explainFocused(index: Explained) {
    setExplainedRows({ hovered: null, tapped: null, focused: index })
  }

  function explainHovered(index: Explained) {
    setExplainedRows((rows) => ({ ...rows, hovered: index }))
  }

  function stopHovering(index: Explained) {
    setExplainedRows((rows) => (rows.hovered === index ? { ...rows, hovered: null } : rows))
  }

  // A tap on the mark explains it rather than choosing the row; a mouse click chooses as usual.
  function tapMark(index: Explained) {
    setExplainedRows((rows) => ({ ...rows, tapped: rows.tapped === index ? null : index }))
  }

  // The pointer keeps the heading's message while it moves across the heading and onto the message,
  // so a viewer can move it there to read (WCAG 2.2, 1.4.13).
  function leaveHeadingCaution(next: EventTarget | null) {
    const stays = [headingRef.current, explanationRef.current].some(
      (region) => next instanceof Node && region?.contains(next),
    )
    if (!stays) {
      stopHovering(HEADING)
    }
  }

  // No row has focus while the heading's caution has it, so no row that goes takes focus back.
  function focusHeadingCaution() {
    focusedRow.current = null
    explainFocused(HEADING)
  }

  // The heading's caution comes before the rows, and the anchor before both. Shift+Tab to the anchor
  // dismisses the menu, because the outside checks count the anchor as part of it.
  function handleRowKey(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault()
      if (headingCautionRef.current) {
        headingCautionRef.current.focus()
        return
      }
      returnToAnchor()
      return
    }
    moveBetweenRows(event)
  }

  // The rows take one stop in the Tab order, so Tab from the heading's caution focuses the chosen row.
  function handleHeadingCautionKey(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') {
      return
    }
    event.preventDefault()
    if (event.shiftKey) {
      returnToAnchor()
      return
    }
    focusCheckedOrNearestRow(menuRef.current, focusedRow.current?.index ?? 0)
  }

  return (
    <div ref={surfaceRef} className={styles.popover}>
      <div
        ref={headingRef}
        className={styles.heading}
        onPointerLeave={(event) => leaveHeadingCaution(event.relatedTarget)}
      >
        <span id={headingId}>{heading}</span>
        {message && (
          <>
            <button
              ref={headingCautionRef}
              type="button"
              aria-label={message}
              className={styles.headingCaution}
              onClick={() => tapMark(HEADING)}
              onFocus={focusHeadingCaution}
              onPointerEnter={() => explainHovered(HEADING)}
              onKeyDown={handleHeadingCautionKey}
            >
              <Icon name="alert" size={14} />
            </button>
            <span id={messageId} hidden>
              {message}
            </span>
          </>
        )}
      </div>
      <div
        ref={menuRef}
        id={id}
        role="menu"
        aria-labelledby={headingId}
        aria-describedby={message && messageId}
        className={styles.menu}
      >
        {options.map((option, index) => {
          const checked = option.id === selected
          return (
            <Fragment key={String(option.id)}>
              {option.divided && <hr className={styles.divider} />}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                aria-label={cautionedName(option)}
                tabIndex={-1}
                className={styles.row}
                onPointerDown={(event) => {
                  pressedByTouch.current = event.pointerType === 'touch'
                }}
                onClick={(event) => {
                  if (pressedByTouch.current && isOnTheMark(event) && explanations[index]) {
                    tapMark(index)
                    return
                  }
                  choose(option.id)
                }}
                onFocus={(event) => focusRow(event.currentTarget, index)}
                onPointerEnter={() => explainHovered(index)}
                onPointerLeave={() => stopHovering(index)}
                onKeyDown={handleRowKey}
              >
                <span className={styles.label}>
                  {option.label}
                  {option.caution && (
                    <span className={styles.caution} data-mark data-testid="mark">
                      <Icon name="alert" size={14} label={ownExplanation(option)} />
                    </span>
                  )}
                </span>
                {checked && <Icon name="check" size={14} />}
              </button>
            </Fragment>
          )
        })}
        {toggle && <hr className={styles.divider} />}
        {toggle && (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={toggle.checked}
            aria-disabled={toggle.unavailable ? true : undefined}
            aria-label={toggle.unavailable && `${toggle.label}. ${toggle.unavailable}`}
            tabIndex={-1}
            className={`${styles.row} ${styles.toggle}`}
            onClick={() => pressToggle(toggle, options.length)}
            onFocus={(event) => focusRow(event.currentTarget, options.length)}
            onPointerEnter={() => explainHovered(options.length)}
            onPointerLeave={() => stopHovering(options.length)}
            onKeyDown={handleRowKey}
          >
            <span className={styles.label}>{toggle.label}</span>
            {toggle.checked && <Icon name="check" size={14} />}
          </button>
        )}
      </div>
      {longestCaution && (
        <div
          ref={explanationRef}
          className={styles.explanation}
          style={{
            visibility: explanation ? undefined : 'hidden',
            pointerEvents: explainedIndex === HEADING ? 'auto' : undefined,
          }}
          aria-hidden="true"
          onPointerLeave={(event) => leaveHeadingCaution(event.relatedTarget)}
        >
          {explanation ?? longestCaution}
        </div>
      )}
    </div>
  )
}

// A row's name from its content would join the label and the mark's name with no space between
// them, so a cautioned row names both itself, with a sentence break.
function cautionedName<Id>(option: PopoverOption<Id>): string | undefined {
  const explanation = ownExplanation(option)
  return explanation && `${option.label}. ${explanation}`
}

function ownExplanation<Id>({ caution, explainedByMessage }: PopoverOption<Id>) {
  return explainedByMessage ? undefined : caution
}

function explanationOf({
  explained,
  explanations,
  message,
}: {
  explained: Explained | null
  explanations: readonly (string | undefined)[]
  message: string | undefined
}): string | undefined {
  if (explained === HEADING) {
    return message
  }
  return explained === null ? undefined : explanations[explained]
}

// The line that an explanation sits level with: the heading for the message, or the row it explains.
function explainedLine({
  explained,
  heading,
  menu,
}: {
  explained: Explained | null
  heading: HTMLElement | null
  menu: HTMLElement | null
}): HTMLElement | undefined {
  if (explained === HEADING) {
    return heading ?? undefined
  }
  return explained === null ? undefined : rowsOf(menu)[explained]
}

function rowsOf(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(
    menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitemcheckbox"]') ?? [],
  )
}

function focusCheckedOrNearestRow(menu: HTMLElement | null, index: number) {
  const rows = rowsOf(menu)
  const checked = rows.find(
    (row) =>
      row.getAttribute('role') === 'menuitemradio' && row.getAttribute('aria-checked') === 'true',
  )
  const target = checked ?? rows.at(Math.min(index, rows.length - 1))
  target?.focus()
}

/** Moves focus between a menu's rows with the arrow keys, Home and End. */
export function moveBetweenRows(event: ReactKeyboardEvent<HTMLElement>) {
  const move = ROW_MOVES.get(event.key)
  if (!move) {
    return
  }
  event.preventDefault()
  const rows = rowsOf(event.currentTarget.parentElement)
  rows[move(rows.indexOf(event.currentTarget), rows.length)]?.focus()
}

function longestOf(texts: readonly (string | undefined)[]): string | undefined {
  return texts.reduce<string | undefined>(
    (longest, text) => (text && text.length > (longest?.length ?? 0) ? text : longest),
    undefined,
  )
}

// Level with the line it explains on the side away from the screen edge, beside the menu so it
// covers no row, or above the menu where the screen leaves no room beside it. Returns the room the
// menu keeps above itself for it, which only grows while it stays above.
function placeExplanation({
  explanation,
  line,
  surface,
  reservedRoom,
}: {
  explanation: HTMLElement | null
  line: HTMLElement | undefined
  surface: HTMLElement | null
  reservedRoom: number
}): number {
  if (!explanation || !surface) {
    return reservedRoom
  }
  if (surface.offsetLeft < EXPLANATION_MAX_WIDTH_PX + EXPLANATION_GAP_PX) {
    explanation.dataset.side = 'above'
    explanation.style.top = ''
    return Math.max(reservedRoom, explanation.offsetHeight + EXPLANATION_GAP_PX)
  }
  explanation.dataset.side = 'start'
  explanation.style.top = line ? `${line.offsetTop - (line.parentElement?.scrollTop ?? 0)}px` : ''
  return 0
}

// The rows scroll rather than come closer to the screen's edge than the gap: the top edge, plus the
// room kept above them, for a menu above its anchor; the bottom edge for a menu below it.
function limitHeight({
  surface,
  firstRow,
  roomAbove,
  placement,
}: {
  surface: HTMLElement | null
  firstRow: HTMLElement | undefined
  roomAbove: number
  placement: Side
}) {
  if (!surface) {
    return
  }
  const side = sideThatShowsARow({ surface, firstRow, roomAbove, placement })
  surface.style.maxHeight = `${limitAfterMovingTo(side, surface, roomAbove)}px`
}

// A menu placed below its anchor goes above it instead where the screen ends too close under the
// anchor to show a row and leaves more room above it.
function sideThatShowsARow({
  surface,
  firstRow,
  roomAbove,
  placement,
}: {
  surface: HTMLElement
  firstRow: HTMLElement | undefined
  roomAbove: number
  placement: Side
}): Side {
  if (placement === 'above' || !firstRow) {
    return placement
  }
  // The row's height a second time covers the surface's own edge under the rows.
  const heightThatShowsARow = firstRow.offsetTop + 2 * firstRow.offsetHeight
  const below = limitAfterMovingTo('below', surface, roomAbove)
  if (below >= heightThatShowsARow) {
    return 'below'
  }
  return limitAfterMovingTo('above', surface, roomAbove) > below ? 'above' : 'below'
}

// The stylesheet places the surface from this attribute, and only a surface on a side of the anchor
// can measure the height limit there.
function limitAfterMovingTo(side: Side, surface: HTMLElement, roomAbove: number): number {
  surface.dataset.placement = side
  const box = surface.getBoundingClientRect()
  if (side === 'below') {
    return window.innerHeight - box.top - SCREEN_EDGE_GAP_PX
  }
  return box.bottom - SCREEN_EDGE_GAP_PX - roomAbove
}

function alignToAnchor(surface: HTMLElement | null, anchor: HTMLElement | null) {
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
}

// A touch on the mark explains it; anywhere else on the row picks the choice.
function isOnTheMark(event: { target: EventTarget }): boolean {
  return event.target instanceof Element && event.target.closest('[data-mark]') !== null
}
