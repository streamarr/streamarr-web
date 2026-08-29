import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SeasonSideRail } from './SeasonSideRail'

function season(number: number, unwatched: number) {
  return { id: `s${number}`, label: `Season ${number}`, unwatchedCount: unwatched }
}

describe('SeasonSideRail', () => {
  it('lists each season with its unwatched count, or a check once fully watched', () => {
    render(<SeasonSideRail seasons={[season(1, 0), season(2, 3)]} selectedId="s2" onSelect={() => {}} />)
    expect(screen.getByText('Seasons · 2')).toBeInTheDocument()
    const first = screen.getByRole('button', { name: /Season 1/ })
    expect(first).toHaveTextContent('Season 1')
    expect(screen.getByLabelText('Watched')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Season 2/ })).toHaveTextContent('3')
  })

  it('marks the selected season as current', () => {
    render(<SeasonSideRail seasons={[season(1, 0), season(2, 3)]} selectedId="s2" onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: /Season 2/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Season 1/ })).not.toHaveAttribute('aria-current')
  })

  it('reports the season a row is clicked for', async () => {
    const onSelect = vi.fn()
    render(<SeasonSideRail seasons={[season(1, 0), season(2, 3)]} selectedId="s1" onSelect={onSelect} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /Season 2/ }))
    expect(onSelect).toHaveBeenCalledWith('s2')
  })

  it('caps the rail at five rows behind a chevron and reveals the rest on demand', async () => {
    const seasons = Array.from({ length: 12 }, (_, index) => season(index + 1, index))
    render(<SeasonSideRail seasons={seasons} selectedId="s1" onSelect={() => {}} />)
    expect(screen.getAllByRole('button', { name: /^Season/ })).toHaveLength(5)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Show all 12 seasons' }))

    expect(screen.getAllByRole('button', { name: /^Season/ })).toHaveLength(12)
    expect(screen.queryByRole('button', { name: 'Show all 12 seasons' })).not.toBeInTheDocument()
  })

  it('starts expanded when the selected season would otherwise be hidden', () => {
    const seasons = Array.from({ length: 8 }, (_, index) => season(index + 1, index))
    render(<SeasonSideRail seasons={seasons} selectedId="s7" onSelect={() => {}} />)
    expect(screen.getAllByRole('button', { name: /^Season/ })).toHaveLength(8)
  })
})
