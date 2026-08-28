import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SortMenu } from './SortMenu'

describe('SortMenu', () => {
  it('shows the current sort label on the trigger', () => {
    render(<SortMenu sort={{ by: 'ADDED', direction: 'DESC' }} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Sort: Recently added' })).toBeInTheDocument()
  })

  it('lists all five options when opened', async () => {
    const user = userEvent.setup()
    render(<SortMenu sort={{ by: 'ADDED', direction: 'DESC' }} onChange={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Sort: Recently added' }))

    expect(screen.getByRole('menuitemradio', { name: 'Recently added' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Release date' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Runtime' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Last watched' })).toBeInTheDocument()
  })

  it('calls onChange with the selected option and closes', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<SortMenu sort={{ by: 'ADDED', direction: 'DESC' }} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Sort: Recently added' }))

    await user.click(screen.getByRole('menuitemradio', { name: 'Title' }))

    expect(onChange).toHaveBeenCalledWith({ by: 'TITLE', direction: 'ASC' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on outside click', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <SortMenu sort={{ by: 'ADDED', direction: 'DESC' }} onChange={() => {}} />
        <button type="button">Outside</button>
      </div>,
    )
    await user.click(screen.getByRole('button', { name: 'Sort: Recently added' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Outside' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<SortMenu sort={{ by: 'ADDED', direction: 'DESC' }} onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Sort: Recently added' }))

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
