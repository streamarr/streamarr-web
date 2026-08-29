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

  it('renders a progress bar beside the corner badge for a season in progress', () => {
    const { container } = render(
      <PosterCard
        title="Season 2"
        meta="2018"
        image={null}
        blurHash={null}
        badge={{ status: 'unwatched-count', count: 3 }}
        progressPercent={56}
      />,
    )
    expect(screen.getByLabelText('3 unwatched')).toBeInTheDocument()
    expect(container.querySelector('[style*="width: 56%"]')).not.toBeNull()
  })
})
