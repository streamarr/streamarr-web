import { type RefObject, useEffect, useEffectEvent, useRef, useState } from 'react'

const IDLE_AFTER_MS = 3_000
const WAKE_EVENTS = ['pointermove', 'keydown'] as const

/**
 * Whether the viewer has left the pointer and keyboard alone for three seconds. The viewer never
 * counts as idle while `held`, nor while the mouse rests on one of the `chromeRefs` elements.
 */
export function useIdle(
  held: boolean,
  chromeRefs: readonly RefObject<HTMLElement | null>[],
): boolean {
  const [idle, setIdle] = useState(false)
  const mouseOnChrome = useRef(false)
  if (held && idle) {
    setIdle(false)
  }
  const isOnChrome = useEffectEvent(
    (target: EventTarget | null) =>
      target instanceof Node && chromeRefs.some((chrome) => chrome.current?.contains(target)),
  )

  // Enter and leave events cannot say where the mouse is: a browser sends no leave when the
  // element under the mouse is replaced, such as a glyph that changes on click.
  useEffect(() => {
    const trackMouseOverChrome = (event: PointerEvent) => {
      const under = event.type === 'pointerout' ? event.relatedTarget : event.target
      mouseOnChrome.current = event.pointerType === 'mouse' && isOnChrome(under)
    }
    document.addEventListener('pointermove', trackMouseOverChrome)
    document.addEventListener('pointerout', trackMouseOverChrome)
    return () => {
      document.removeEventListener('pointermove', trackMouseOverChrome)
      document.removeEventListener('pointerout', trackMouseOverChrome)
    }
  }, [])

  useEffect(() => {
    if (held) {
      return undefined
    }
    let faded = false
    const settle = () => {
      if (mouseOnChrome.current) {
        timer = setTimeout(settle, IDLE_AFTER_MS)
        return
      }
      faded = true
      setIdle(true)
    }
    let timer = setTimeout(settle, IDLE_AFTER_MS)
    const wake = () => {
      faded = false
      clearTimeout(timer)
      setIdle(false)
      timer = setTimeout(settle, IDLE_AFTER_MS)
    }
    // A touch browser hit-tests a tap's click after the tap has woken the controls, so the click
    // would press whichever faded control lay under the finger.
    const wakeFromPress = (event: PointerEvent) => {
      document.removeEventListener('click', swallowClick, true)
      if (faded && event.pointerType !== 'mouse') {
        document.addEventListener('click', swallowClick, { capture: true, once: true })
      }
      wake()
    }
    for (const event of WAKE_EVENTS) {
      document.addEventListener(event, wake)
    }
    document.addEventListener('pointerdown', wakeFromPress)
    return () => {
      clearTimeout(timer)
      for (const event of WAKE_EVENTS) {
        document.removeEventListener(event, wake)
      }
      document.removeEventListener('pointerdown', wakeFromPress)
      document.removeEventListener('click', swallowClick, true)
    }
  }, [held])

  return idle
}

function swallowClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}
