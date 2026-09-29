import { useEffect, useState } from 'react'

const IDLE_AFTER_MS = 3_000
const WAKE_EVENTS = ['pointermove', 'pointerdown', 'keydown'] as const

/**
 * Whether the viewer has left the pointer and keyboard alone for three seconds. While `held`, the
 * viewer never counts as idle.
 */
export function useIdle(held: boolean): boolean {
  const [idle, setIdle] = useState(false)
  if (held && idle) {
    setIdle(false)
  }

  useEffect(() => {
    if (held) {
      return undefined
    }
    let timer = setTimeout(() => setIdle(true), IDLE_AFTER_MS)
    const wake = () => {
      clearTimeout(timer)
      setIdle(false)
      timer = setTimeout(() => setIdle(true), IDLE_AFTER_MS)
    }
    for (const event of WAKE_EVENTS) {
      document.addEventListener(event, wake)
    }
    return () => {
      clearTimeout(timer)
      for (const event of WAKE_EVENTS) {
        document.removeEventListener(event, wake)
      }
    }
  }, [held])

  return idle
}
