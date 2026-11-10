import { type RefObject, useEffect, useState } from 'react'

// The seek track's hit area reaches up to 14 pixels above the control bar's top edge; the rest
// keeps a gap between it and whatever ends above it.
const ABOVE_THE_BAR_PX = 24

/**
 * How many pixels the control bar, with the seek track above its edge, reaches up from the
 * player's bottom, measured again whenever the player or the bar changes size. Null until the
 * first measurement, and while not `watching`.
 */
export function useControlsReach({
  playerRef,
  controlsRef,
  watching,
}: Readonly<{
  playerRef: RefObject<HTMLElement | null>
  controlsRef: RefObject<HTMLElement | null>
  watching: boolean
}>): number | null {
  const [reach, setReach] = useState<number | null>(null)
  useEffect(() => {
    const player = playerRef.current
    const controls = controlsRef.current
    if (!watching || !player || !controls) {
      return undefined
    }
    const observer = new ResizeObserver(() => {
      const bottom = player.getBoundingClientRect().bottom
      setReach(Math.ceil(bottom - controls.getBoundingClientRect().top) + ABOVE_THE_BAR_PX)
    })
    observer.observe(player)
    observer.observe(controls)
    return () => {
      observer.disconnect()
      setReach(null)
    }
  }, [playerRef, controlsRef, watching])
  return reach
}
