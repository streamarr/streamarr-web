import { useCallback, type RefObject } from 'react'

/**
 * Moves focus to `fallback` when a change made elsewhere takes away the element that had focus in
 * a live list, as when the row a person was on leaves. Attach the returned ref to each live list's
 * container. A dialog returns focus to its own trigger, so focus inside one is left to it. Focus
 * that the page moves itself stays where it went: the check waits until the page's own focus
 * moves have run, and acts only if focus is still lost.
 */
export function useFocusFallback(fallback: RefObject<HTMLElement | null>) {
  return useCallback(
    (container: HTMLElement | null) => {
      if (!container) return undefined
      let focused = rowElement(document.activeElement, container)
      let check: ReturnType<typeof setTimeout> | undefined
      const onFocusIn = (event: FocusEvent) => {
        focused = rowElement(event.target, container)
      }
      const lost = new MutationObserver(() => {
        if (!focused || focused.isConnected) return
        focused = null
        clearTimeout(check)
        check = setTimeout(() => {
          if (document.activeElement !== document.body && document.activeElement !== null) return
          fallback.current?.focus({ preventScroll: true })
        })
      })
      document.addEventListener('focusin', onFocusIn)
      lost.observe(container, { childList: true, subtree: true })
      return () => {
        clearTimeout(check)
        document.removeEventListener('focusin', onFocusIn)
        lost.disconnect()
      }
    },
    [fallback],
  )
}

/** The element that has focus when it sits in the container, outside any dialog. */
function rowElement(target: EventTarget | null, container: HTMLElement): Element | null {
  if (!(target instanceof Element) || !container.contains(target)) return null
  return target.closest('[role=dialog]') ? null : target
}
