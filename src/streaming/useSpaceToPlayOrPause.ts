import { useEffect, useEffectEvent, useRef } from 'react'

const PRESSED_BY_SPACE = 'a[href], button, input, select, textarea'

/**
 * Calls `toggle` when the viewer presses Space while `enabled`, once for each press. Space keeps
 * its usual meaning on a button, link or form control that the viewer reached by keyboard.
 */
export function useSpaceToPlayOrPause(enabled: boolean, toggle: () => void): void {
  const onSpace = useEffectEvent(toggle)
  const controlReachedByKeyboard = useRef<Element | null>(null)

  useEffect(() => {
    const noteHowFocusArrived = (event: FocusEvent) => {
      controlReachedByKeyboard.current = isControlReachedByKeyboard(event.target)
        ? event.target
        : null
    }
    document.addEventListener('focusin', noteHowFocusArrived)
    return () => document.removeEventListener('focusin', noteHowFocusArrived)
  }, [])

  useEffect(() => {
    if (!enabled) {
      return undefined
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
    document.addEventListener('keydown', playOrPause)
    return () => document.removeEventListener('keydown', playOrPause)
  }, [enabled])
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
