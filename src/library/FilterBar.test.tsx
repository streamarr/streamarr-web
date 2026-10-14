import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterBar } from './FilterBar'

describe('FilterBar', () => {
  it('shouldCountTheLibraryOnTheAllChipOnly', () => {
    render(<FilterBar status="ALL" total={1799} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'All 1,799' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Unwatched' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'In progress' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()
  })

  it('shouldLeaveTheAllChipUncountedForAnEmptyLibrary', () => {
    render(<FilterBar status="ALL" total={0} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
  })

  it('calls onChange with the tapped chip', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<FilterBar status="ALL" total={1799} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Unwatched' }))

    expect(onChange).toHaveBeenCalledWith('UNWATCHED')
  })
})
