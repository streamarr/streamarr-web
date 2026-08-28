import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterBar } from './FilterBar'

describe('FilterBar', () => {
  it('renders the three chips and the showing count', () => {
    render(<FilterBar status="ALL" onChange={() => {}} showing="Showing 1–24 of 1,284" />)
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Unwatched' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'In progress' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Showing 1–24 of 1,284')).toBeInTheDocument()
  })

  it('calls onChange with the tapped chip', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<FilterBar status="ALL" onChange={onChange} showing="" />)

    await user.click(screen.getByRole('button', { name: 'Unwatched' }))

    expect(onChange).toHaveBeenCalledWith('UNWATCHED')
  })
})
