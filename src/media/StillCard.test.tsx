import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StillCard } from './StillCard'

describe('StillCard', () => {
  it('renders the title and subtitle', () => {
    render(
      <StillCard
        title="Northern Line"
        subtitle="S2 E5 · Breakage · 24m left"
        image={null}
        blurHash={null}
      />,
    )
    expect(screen.getByText('Northern Line')).toBeInTheDocument()
    expect(screen.getByText('S2 E5 · Breakage · 24m left')).toBeInTheDocument()
  })

  it('renders a movie-shaped subtitle with no episode prefix', () => {
    render(<StillCard title="Everlight" subtitle="18m left" image={null} blurHash={null} />)
    expect(screen.getByText('18m left')).toBeInTheDocument()
  })

  it('renders the watched badge when given one', () => {
    render(
      <StillCard
        title="E6 — Grievances"
        subtitle="47m"
        image={null}
        blurHash={null}
        badge={{ status: 'watched' }}
      />,
    )
    expect(screen.getByLabelText('Watched')).toBeInTheDocument()
  })
})
