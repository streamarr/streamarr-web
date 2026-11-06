import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { resizeObserverInstances } from '../../vitest.setup'
import { useControlsReach } from './useControlsReach'

// An element whose box spans `top` to `bottom` in the viewport.
function boxed({ top, bottom }: { top: number; bottom: number }): HTMLElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => DOMRect.fromRect({ y: top, height: bottom - top })
  return element
}

function resize() {
  act(() => {
    for (const observer of resizeObserverInstances) {
      observer.callback([], observer)
    }
  })
}

describe('useControlsReach', () => {
  it('shouldMeasureHowFarTheControlsAndTheSeekTrackReachUpWhenThePlayerOrBarResizes', () => {
    const player = { current: boxed({ top: 0, bottom: 667 }) }
    const controls = { current: boxed({ top: 417.4, bottom: 651 }) }
    const { result } = renderHook(() =>
      useControlsReach({ playerRef: player, controlsRef: controls, watching: true }),
    )
    expect(result.current).toBeNull()

    resize()
    expect(result.current).toBe(250 + 24)

    controls.current.getBoundingClientRect = () => DOMRect.fromRect({ y: 397, height: 254 })
    resize()
    expect(result.current).toBe(270 + 24)
  })

  it('shouldForgetTheMeasurementWhenItStopsWatching', () => {
    const player = { current: boxed({ top: 0, bottom: 667 }) }
    const controls = { current: boxed({ top: 417, bottom: 651 }) }
    const { result, rerender } = renderHook(
      ({ watching }) => useControlsReach({ playerRef: player, controlsRef: controls, watching }),
      { initialProps: { watching: true } },
    )
    resize()

    rerender({ watching: false })

    expect(result.current).toBeNull()
  })
})
