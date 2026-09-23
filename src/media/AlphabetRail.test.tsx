import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AlphabetRail } from './AlphabetRail'

const INDEX = [
  { letter: 'A', count: 12 },
  { letter: 'B', count: 0 },
  { letter: 'N', count: 4 },
  { letter: 'HASH', count: 2 },
]

describe('AlphabetRail', () => {
  it('never renders a letter with a zero count', () => {
    render(<AlphabetRail index={INDEX} selected={null} onSelect={() => {}} />)
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('renders HASH as "#"', () => {
    render(<AlphabetRail index={INDEX} selected={null} onSelect={() => {}} />)
    expect(screen.getByText('#')).toBeInTheDocument()
  })

  it('marks the selected letter as pressed', () => {
    render(<AlphabetRail index={INDEX} selected="N" onSelect={() => {}} />)
    expect(screen.getByText('N')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('A')).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onSelect with the tapped letter', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<AlphabetRail index={INDEX} selected={null} onSelect={onSelect} />)

    await user.click(screen.getByText('N'))

    expect(onSelect).toHaveBeenCalledWith('N')
  })

  it('calls onSelect with null when the active letter is tapped again', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<AlphabetRail index={INDEX} selected="N" onSelect={onSelect} />)

    await user.click(screen.getByText('N'))

    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
