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
        progressPercent={51}
      />,
    )
    expect(screen.getByText('Northern Line')).toBeInTheDocument()
    expect(screen.getByText('S2 E5 · Breakage · 24m left')).toBeInTheDocument()
  })

  it('renders a movie-shaped subtitle with no episode prefix', () => {
    render(<StillCard title="Everlight" subtitle="18m left" image={null} blurHash={null} progressPercent={80} />)
    expect(screen.getByText('18m left')).toBeInTheDocument()
  })

  it('sizes the progress bar to progressPercent', () => {
    const { container } = render(
      <StillCard title="Everlight" subtitle="18m left" image={null} blurHash={null} progressPercent={33} />,
    )
    expect(container.querySelector('[style]')).toHaveStyle({ width: '33%' })
  })
})
