import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BackdropHero } from './BackdropHero'

const IMAGE = { url: 'backdrop.jpg', aspectRatio: 1.78 }
const CORNERS = { topLeft: '#0d322c', topRight: '#123f38', bottomRight: '#071f1b', bottomLeft: '#0e3b34' }

describe('BackdropHero', () => {
  it('renders the backdrop at the requested height', () => {
    render(<BackdropHero image={IMAGE} blurHash={null} corners={null} height={560} alt="Northern Line backdrop" />)
    expect(screen.getByRole('img', { name: 'Northern Line backdrop' })).toHaveAttribute('src', 'backdrop.jpg')
    expect(screen.getByTestId('backdrop-hero')).toHaveStyle({ height: '560px' })
  })

  it('places the back and metadata slots over the artwork', () => {
    render(
      <BackdropHero
        image={IMAGE}
        blurHash={null}
        corners={null}
        height={400}
        alt=""
        back={<a href="/series/s1">Northern Line</a>}
        metadata={<dl>Genre</dl>}
      />,
    )
    expect(screen.getByRole('link', { name: 'Northern Line' })).toBeInTheDocument()
    expect(screen.getByText('Genre')).toBeInTheDocument()
  })

  it('tints the artwork with the corner colors when the server provides them', () => {
    render(<BackdropHero image={IMAGE} blurHash={null} corners={CORNERS} height={560} alt="" />)
    const hint = screen.getByTestId('corner-hint')
    expect(hint.style.getPropertyValue('--corner-top-left')).toBe('#0d322c')
    expect(hint.style.getPropertyValue('--corner-bottom-right')).toBe('#071f1b')
  })

  it('renders no corner tint when there are no ambient colors', () => {
    render(<BackdropHero image={IMAGE} blurHash={null} corners={null} height={560} alt="" />)
    expect(screen.queryByTestId('corner-hint')).not.toBeInTheDocument()
  })

  it('still renders the placeholder box when there is no artwork', () => {
    render(<BackdropHero image={null} blurHash={null} corners={null} height={360} alt="" />)
    expect(screen.getByTestId('backdrop-hero')).toHaveStyle({ height: '360px' })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
