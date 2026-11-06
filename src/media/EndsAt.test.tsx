import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EndsAt } from './EndsAt'

function clock(hours: number, minutes: number) {
  return new Date(2026, 10, 5, hours, minutes).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Moves the clock on after the page renders and before the effects that follow it start.
function ElapseBeforeLaterEffects({ ms }: Readonly<{ ms: number }>) {
  useEffect(() => {
    vi.setSystemTime(Date.now() + ms)
  }, [ms])
  return null
}

describe('EndsAt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 5, 15, 0, 30))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldShowWhenTheRemainingTimeWouldEnd', () => {
    render(<EndsAt remainingSeconds={2 * 3600 + 20 * 60} />)
    expect(screen.getByRole('img', { name: 'Ends at' })).toBeInTheDocument()
    expect(screen.getByText(clock(17, 20))).toBeInTheDocument()
  })

  it('shouldMoveTheEndTimeOnWhenTheMinuteTurns', () => {
    render(<EndsAt remainingSeconds={10 * 60} />)
    expect(screen.getByText(clock(15, 10))).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByText(clock(15, 11))).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText(clock(15, 12))).toBeInTheDocument()
  })

  it('shouldMoveTheEndTimeOnWhenTheEndTimeReachesTheNextMinute', () => {
    render(<EndsAt remainingSeconds={10 * 60 + 45} />)
    expect(screen.getByText(clock(15, 11))).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(45_000)
    })
    expect(screen.getByText(clock(15, 12))).toBeInTheDocument()
  })

  it('shouldCountFromTheCurrentTimeWhenTheRemainingTimeChanges', () => {
    const { rerender } = render(<EndsAt remainingSeconds={10 * 60} />)
    act(() => {
      vi.advanceTimersByTime(25_000)
    })
    rerender(<EndsAt remainingSeconds={10 * 60 + 10} />)
    expect(screen.getByText(clock(15, 11))).toBeInTheDocument()
  })

  it('shouldMoveTheEndTimeOnWhenItsMinuteTurnsBeforeTheClockStarts', () => {
    vi.setSystemTime(new Date(2026, 10, 5, 15, 0, 29, 999))
    render(
      <>
        <ElapseBeforeLaterEffects ms={2} />
        <EndsAt remainingSeconds={10 * 60 + 30} />
      </>,
    )
    expect(screen.getByText(clock(15, 10))).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByText(clock(15, 11))).toBeInTheDocument()
  })
})
