import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { badgeFromWatchState, WatchedBadge } from './WatchedBadge'

describe('WatchedBadge', () => {
  it('renders a mint check for the watched state', () => {
    render(<WatchedBadge status="watched" />)
    expect(screen.getByLabelText('Watched')).toBeInTheDocument()
  })

  it('renders a bottom progress bar sized to percentComplete for the in-progress state', () => {
    const { container } = render(<WatchedBadge status="in-progress" percentComplete={42} />)
    const fill = container.querySelector('[style]')
    expect(fill).toHaveStyle({ width: '42%' })
  })

  it('renders the unwatched count for a season or series poster that is not fully watched', () => {
    render(<WatchedBadge status="unwatched-count" count={3} />)
    expect(screen.getByLabelText('3 unwatched')).toHaveTextContent('3')
  })
})

describe('badgeFromWatchState', () => {
  it('maps WATCHED to the watched badge', () => {
    expect(badgeFromWatchState('WATCHED', null)).toEqual({ status: 'watched' })
  })

  it('maps IN_PROGRESS with a known percentage to the in-progress badge', () => {
    expect(badgeFromWatchState('IN_PROGRESS', 65)).toEqual({ status: 'in-progress', percentComplete: 65 })
  })

  it('renders no badge for UNWATCHED', () => {
    expect(badgeFromWatchState('UNWATCHED', null)).toBeUndefined()
  })

  it('renders no badge for IN_PROGRESS with no known percentage', () => {
    expect(badgeFromWatchState('IN_PROGRESS', null)).toBeUndefined()
  })
})
