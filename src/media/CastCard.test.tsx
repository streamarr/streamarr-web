import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CastCard } from './CastCard'

describe('CastCard', () => {
  it('shows the portrait and the name', () => {
    render(<CastCard name="Placeholder Name" image={{ url: 'portrait.jpg', aspectRatio: 0.78 }} blurHash={null} />)
    expect(screen.getByRole('img', { name: 'Placeholder Name' })).toHaveAttribute('src', 'portrait.jpg')
    expect(screen.getByText('Placeholder Name')).toBeInTheDocument()
  })

  it('keeps the name and a placeholder box when there is no portrait', () => {
    render(<CastCard name="No Photo" image={null} blurHash={null} />)
    expect(screen.getByText('No Photo')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
