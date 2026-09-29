import { type RefObject, useEffect, useRef, useState } from 'react'

const IDLE_AFTER_MS = 3_000
const WAKE_EVENTS = ['pointermove', 'pointerdown', 'keydown'] as const

/**
 * Whether the viewer has left the pointer and keyboard alone for three seconds. The viewer never
 * counts as idle while `held`, nor while the mouse rests on `controlsRef`'s element.
 */
export function useIdle(held: boolean, controlsRef: RefObject<HTMLElement | null>): boolean {
  const [idle, setIdle] = useState(false)
  const mouseOnControls = useRef(false)
  if (held && idle) {
    setIdle(false)
  }

  // Enter and leave events cannot say where the mouse is: a browser sends no leave when the
  // element under the mouse is replaced, such as a glyph that changes on click.
  useEffect(() => {
    const follow = (event: PointerEvent) => {
      const under = event.type === 'pointerout' ? event.relatedTarget : event.target
      mouseOnControls.current =
        event.pointerType === 'mouse' &&
        under instanceof Node &&
        controlsRef.current?.contains(under) === true
    }
    document.addEventListener('pointermove', follow)
    document.addEventListener('pointerout', follow)
    return () => {
      document.removeEventListener('pointermove', follow)
      document.removeEventListener('pointerout', follow)
    }
  }, [controlsRef])

  useEffect(() => {
    if (held) {
      return undefined
    }
    const settle = () => {
      if (mouseOnControls.current) {
        timer = setTimeout(settle, IDLE_AFTER_MS)
        return
      }
      setIdle(true)
    }
    let timer = setTimeout(settle, IDLE_AFTER_MS)
    const wake = () => {
      clearTimeout(timer)
      setIdle(false)
      timer = setTimeout(settle, IDLE_AFTER_MS)
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
