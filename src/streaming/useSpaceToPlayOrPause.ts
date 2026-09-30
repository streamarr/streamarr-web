import { useEffect, useEffectEvent, useRef } from 'react'

// Where Space does something of its own. It does not follow a link, and an aria-disabled button
// does nothing when pressed.
const PRESSED_BY_SPACE = 'button:not([aria-disabled="true"]), input, select, textarea'

/**
 * Space keeps its usual meaning on a button or form control that the viewer reached by keyboard,
 * unless the button is aria-disabled. Anywhere else, Space calls `toggle` once for each press while
 * `enabled`, and does nothing while not.
 */
export function useSpaceToPlayOrPause(enabled: boolean, toggle: () => void): void {
  const onSpace = useEffectEvent(() => {
    if (enabled) {
      toggle()
    }
  })
  const controlReachedByKeyboard = useRef<Element | null>(null)

  useEffect(() => {
    const noteHowFocusArrived = (event: FocusEvent) => {
      controlReachedByKeyboard.current = isControlReachedByKeyboard(event.target)
        ? event.target
        : null
    }
    const playOrPause = (event: KeyboardEvent) => {
      if (!isBareSpace(event) || event.target === controlReachedByKeyboard.current) {
        return
      }
      // An unprevented keydown, even a repeat, scrolls the page or presses a clicked button on keyup.
      event.preventDefault()
      if (event.repeat) {
        return
      }
      onSpace()
    }
    document.addEventListener('focusin', noteHowFocusArrived)
    document.addEventListener('keydown', playOrPause)
    return () => {
      document.removeEventListener('focusin', noteHowFocusArrived)
      document.removeEventListener('keydown', playOrPause)
    }
  }, [])
}

function isBareSpace(event: KeyboardEvent): boolean {
  return event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey
}

// Checked as focus lands: any key press gives the focused element :focus-visible before keydown
// listeners run, even when a click focused it.
function isControlReachedByKeyboard(target: EventTarget | null): target is Element {
  return (
    target instanceof Element &&
    target.matches(PRESSED_BY_SPACE) &&
    target.matches(':focus-visible')
  )
}
