import { Store } from '@tanstack/store'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useIntersectionObserver } from '../media/useIntersectionObserver'

const TOP_BAND_ROOT_MARGIN = '0px 0px -90% 0px'

// The letter at the top of the grid lives in a store rather than in state, so only the rail,
// which subscribes to it, re-renders as the viewer scrolls; the grid does not.
export function useVisibleLetter(root: Element | null) {
  const [visibleLetterStore] = useState(() => new Store<string | null>(null))
  const lettersByElement = useRef(new Map<Element, string>())
  const elementsInTopBand = useRef(new Set<Element>())

  const topBandOptions = useMemo<IntersectionObserverInit>(
    () => ({ root, rootMargin: TOP_BAND_ROOT_MARGIN, threshold: 0 }),
    [root],
  )

  const recomputeVisibleLetter = useCallback(() => {
    // Ref cleanup can run while an item is still connected, so prune by DOM attachment.
    removeDetachedElements(elementsInTopBand.current)
    const topmost = [...elementsInTopBand.current].sort(compareByTopThenDocumentOrder)[0]
    const letter = topmost ? (lettersByElement.current.get(topmost) ?? null) : null
    visibleLetterStore.setState(() => letter)
  }, [visibleLetterStore])

  const observe = useIntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        elementsInTopBand.current.add(entry.target)
      } else {
        elementsInTopBand.current.delete(entry.target)
      }
    }
    recomputeVisibleLetter()
  }, topBandOptions)

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
    [observe, recomputeVisibleLetter],
  )

  return { visibleLetterStore, registerItem }
}

function removeDetachedElements(elements: Set<Element>) {
  for (const element of elements) {
    if (!element.isConnected) {
      elements.delete(element)
    }
  }
}

function compareByTopThenDocumentOrder(a: Element, b: Element) {
  const verticalOrder = a.getBoundingClientRect().top - b.getBoundingClientRect().top
  if (verticalOrder !== 0) return verticalOrder
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}
