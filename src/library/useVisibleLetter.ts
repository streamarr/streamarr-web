import { useCallback, useRef, useState } from 'react'
import { useIntersectionObserver } from '../media/useIntersectionObserver'

// A thin band at the very top of the viewport: whichever grid item is crossing it is "where you
// are" in the alphabet, mirroring streamarr-apple's updateVisibleItems (topmost visible item
// drives the rail highlight, independent of any explicit tap).
const TOP_BAND_OPTIONS: IntersectionObserverInit = { rootMargin: '0px 0px -90% 0px', threshold: 0 }

export function useVisibleLetter() {
  const [visibleLetter, setVisibleLetter] = useState<string | null>(null)
  const lettersByElement = useRef(new Map<Element, string>())
  const intersecting = useRef(new Set<Element>())

  const observe = useIntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        intersecting.current.add(entry.target)
      } else {
        intersecting.current.delete(entry.target)
      }
    }
    const topmost = intersecting.current.values().next().value
    setVisibleLetter(topmost ? (lettersByElement.current.get(topmost) ?? null) : null)
  }, TOP_BAND_OPTIONS)

  const registerItem = useCallback(
    (letter: string) => (element: Element | null) => {
      if (element) {
        lettersByElement.current.set(element, letter)
      }
      return observe(element)
    },
    [observe],
  )

  return { visibleLetter, registerItem }
}
