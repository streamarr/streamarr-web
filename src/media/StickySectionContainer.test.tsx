import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StickySectionContainer } from './StickySectionContainer'

describe('StickySectionContainer', () => {
  it('renders the title, the action slot, and children inside the scroll region', () => {
    render(
      <StickySectionContainer title="Recently added in Movies" action={<a href="/library/1">See all</a>}>
        <div>Poster grid</div>
      </StickySectionContainer>,
    )

    expect(screen.getByText('Recently added in Movies')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See all' })).toBeInTheDocument()
    expect(screen.getByText('Poster grid')).toBeInTheDocument()
  })

  it('renders no action element when none is given', () => {
    render(
      <StickySectionContainer title="Recently added in Movies">
        <div>Poster grid</div>
      </StickySectionContainer>,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
