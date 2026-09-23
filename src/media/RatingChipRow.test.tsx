import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RatingChipRow } from './RatingChipRow'

describe('RatingChipRow', () => {
  it('renders one chip per rating, labelled by its own source', () => {
    render(
      <RatingChipRow
        ratings={[
          { id: 'r1', source: 'TMDB', value: '7.8' },
          { id: 'r2', source: 'IMDb', value: '8.1' },
        ]}
      />,
    )
    expect(screen.getByText('TMDB · 7.8')).toBeInTheDocument()
    expect(screen.getByText('IMDb · 8.1')).toBeInTheDocument()
  })

  it('skips null entries the schema allows in the list', () => {
    render(<RatingChipRow ratings={[null, { id: 'r1', source: 'TMDB', value: '7.8' }]} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('renders nothing when there are no ratings', () => {
    const { container } = render(<RatingChipRow ratings={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
