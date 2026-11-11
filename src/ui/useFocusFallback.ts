import { useEffect, type RefObject } from 'react'

/**
 * Moves focus to `fallback` when the element that had focus leaves the page while nothing else
 * takes focus, as when a change made elsewhere takes away the row a person was on. Focus that
 * the page moves itself stays where it went.
 */
export function useFocusFallback(fallback: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let focused: Element | null = document.activeElement
    const onFocusIn = (event: FocusEvent) => {
      focused = event.target instanceof Element ? event.target : null
    }
    const lost = new MutationObserver(() => {
      if (!focused || focused.isConnected) return
      focused = null
      if (document.activeElement === document.body || document.activeElement === null) {
        fallback.current?.focus()
      }
    })
    document.addEventListener('focusin', onFocusIn)
    lost.observe(document.body, { childList: true, subtree: true })
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      lost.disconnect()
    }
  }, [fallback])
}
