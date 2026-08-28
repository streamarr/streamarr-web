import { useCallback, useMemo, useRef, useState } from 'react'
import { useIntersectionObserver } from '../media/useIntersectionObserver'

// A thin band at the very top of the scroll container: whichever grid item is crossing it is
// "where you are" in the alphabet, mirroring streamarr-apple's updateVisibleItems (topmost
// visible item drives the rail highlight, independent of any explicit tap).
export function useVisibleLetter(root: Element | null) {
  const [visibleLetter, setVisibleLetter] = useState<string | null>(null)
  const lettersByElement = useRef(new Map<Element, string>())
  const intersecting = useRef(new Set<Element>())

  const options = useMemo<IntersectionObserverInit>(
    () => ({ root, rootMargin: '0px 0px -90% 0px', threshold: 0 }),
    [root],
  )

  // Pruned lazily by isConnected, not on unmount: registerItem(letter) returns a fresh closure
  // every render (it's called inline in JSX), so a plain state-update-triggered re-render swaps
  // every item's ref identity — including ones that never actually left the DOM — and deleting
  // eagerly from an unmount cleanup would drop those still-valid elements too. A truly removed
  // element (e.g. after a letter jump replaces the list) reads isConnected: false; one merely
  // ref-churned by a re-render is still the same attached node and reads true throughout.
  function recomputeVisibleLetter() {
    for (const element of intersecting.current) {
      if (!element.isConnected) {
        intersecting.current.delete(element)
      }
    }
    const topmost = intersecting.current.values().next().value
    setVisibleLetter(topmost ? (lettersByElement.current.get(topmost) ?? null) : null)
  }

  const observe = useIntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        intersecting.current.add(entry.target)
      } else {
        intersecting.current.delete(entry.target)
      }
    }
    recomputeVisibleLetter()
  }, options)

  const registerItem = useCallback(
    (letter: string) => (element: Element | null) => {
      if (element) {
        lettersByElement.current.set(element, letter)
      }
      const disconnect = observe(element)
      return () => {
        disconnect?.()
        recomputeVisibleLetter()
      }
    },
    [observe],
  )

  return { visibleLetter, registerItem }
}
