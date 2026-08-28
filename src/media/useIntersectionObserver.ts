import { useCallback, useRef } from 'react'

type IntersectionHandler = (entries: IntersectionObserverEntry[]) => void

// A callback ref, not a single ref object: the same hook backs both a lone sentinel (Library's
// infinite-scroll trigger) and many concurrently-rendered targets (the alphabet rail's
// visible-letter tracking), each element getting its own observer via React 19's ref cleanup.
export function useIntersectionObserver(onChange: IntersectionHandler, options?: IntersectionObserverInit) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  return useCallback(
    (element: Element | null) => {
      if (!element) {
        return undefined
      }
      const observer = new IntersectionObserver((entries) => onChangeRef.current(entries), options)
      observer.observe(element)
      return () => observer.disconnect()
    },
    [options?.root, options?.rootMargin, options?.threshold],
  )
}
