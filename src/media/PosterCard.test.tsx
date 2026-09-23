import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PosterCard } from './PosterCard'

describe('PosterCard', () => {
  it('renders the title and meta line', () => {
    render(<PosterCard title="Everlight" meta="2024 · 2h 22m" image={null} blurHash={null} />)
    expect(screen.getByText('Everlight')).toBeInTheDocument()
    expect(screen.getByText('2024 · 2h 22m')).toBeInTheDocument()
  })

  it('renders the watched badge when given one', () => {
    render(
      <PosterCard
        title="Everlight"
        meta="2024"
        image={null}
        blurHash={null}
        badge={{ status: 'watched' }}
      />,
    )
    expect(screen.getByLabelText('Watched')).toBeInTheDocument()
  })

  it('renders no badge when none is given', () => {
    render(<PosterCard title="Everlight" meta="2024" image={null} blurHash={null} />)
    expect(screen.queryByLabelText('Watched')).not.toBeInTheDocument()
  })
})
