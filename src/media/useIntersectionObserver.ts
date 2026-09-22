import { useCallback, useLayoutEffect, useRef } from 'react'

type IntersectionHandler = (entries: IntersectionObserverEntry[]) => void

// Each target gets its own observer and React ref cleanup.
export function useIntersectionObserver(
  onChange: IntersectionHandler,
  options?: IntersectionObserverInit,
) {
  const committedHandlerRef = useRef(onChange)
  useLayoutEffect(
    function commitIntersectionHandler() {
      committedHandlerRef.current = onChange
    },
    [onChange],
  )

  // Callers pass a fresh options object each render, so the observer is keyed by its fields.
  const { root, rootMargin, threshold } = options ?? {}
  return useCallback(
    function observeElement(element: Element | null) {
      if (!element) {
        return undefined
      }
      const observer = new IntersectionObserver((entries) => committedHandlerRef.current(entries), {
        root,
        rootMargin,
        threshold,
      })
      observer.observe(element)
      return () => observer.disconnect()
    },
    [root, rootMargin, threshold],
  )
}
