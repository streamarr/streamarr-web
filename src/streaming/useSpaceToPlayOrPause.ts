import { useEffect, useEffectEvent } from 'react'

// Where Space does something of its own. It does not follow a link, and an aria-disabled button
// does nothing when pressed.
const PRESSED_BY_SPACE = 'button:not([aria-disabled="true"]), input, select, textarea'
// A clicked control gets the mark even while aria-disabled. Its choices can arrive while it has focus.
const CONTROL = 'button, input, select, textarea'
const POINTER_FOCUS = 'data-pointer-focus'

/**
 * Space keeps its usual meaning on a button or form control that the viewer reached by keyboard,
 * or that sits in a menu, unless the button is aria-disabled. Anywhere else, Space calls `toggle`
 * once for each press while `enabled`, and does nothing while not.
 *
 * A button or form control outside a menu that focus reached without the keyboard carries
 * `data-pointer-focus` until focus leaves it. Space plays and pauses there, so that control must
 * not show a focus ring.
 */
export function useSpaceToPlayOrPause(enabled: boolean, toggle: () => void): void {
  const onSpace = useEffectEvent(() => {
    if (enabled) {
      toggle()
    }
  })

  useEffect(() => {
    const noteHowFocusArrived = (event: FocusEvent) => {
      if (isControlReachedWithoutKeyboard(event.target)) {
        event.target.setAttribute(POINTER_FOCUS, '')
      }
    }
    const forgetHowFocusArrived = (event: FocusEvent) => {
      if (event.target instanceof Element) {
        event.target.removeAttribute(POINTER_FOCUS)
      }
    }
    const playOrPause = (event: KeyboardEvent) => {
      if (!isBareSpace(event) || isPressedBySpace(event.target)) {
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
    document.addEventListener('focusout', forgetHowFocusArrived)
    document.addEventListener('keydown', playOrPause)
    return () => {
      document.removeEventListener('focusin', noteHowFocusArrived)
      document.removeEventListener('focusout', forgetHowFocusArrived)
      document.removeEventListener('keydown', playOrPause)
    }
  }, [])
}

function isBareSpace(event: KeyboardEvent): boolean {
  return event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey
}

function isPressedBySpace(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.matches(PRESSED_BY_SPACE) &&
    !target.hasAttribute(POINTER_FOCUS)
  )
}

// Checked as focus lands: any key press gives the focused element :focus-visible before keydown
// listeners run, even when a click focused it.
function isControlReachedWithoutKeyboard(target: EventTarget | null): target is Element {
  return (
    target instanceof Element &&
    target.matches(CONTROL) &&
    !target.matches(':focus-visible') &&
    !isInMenu(target)
  )
}

// However the menu opened, Space presses the focused item there, as Enter does. The mark would hide
// the item's focus ring, and that ring alone shows which item has focus.
function isInMenu(target: Element): boolean {
  return target.closest('[role="menu"]') !== null
}
