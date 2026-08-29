import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DetailHeader } from './DetailHeader'

const BACKDROP = { image: { url: 'backdrop.jpg', aspectRatio: 1.78 }, blurHash: null, corners: null, height: 400 }

describe('DetailHeader', () => {
  it('renders the title as the page heading with every optional block it is given', () => {
    render(
      <DetailHeader
        backdrop={BACKDROP}
        back={<a href="/">Back</a>}
        metadata={[{ label: 'Genre', value: 'Drama' }]}
        eyebrow="Northern Line"
        title="Season 2"
        tagline="Change begins with a whisper."
        metaLine={['2024', '2h 22m', 'PG-13']}
        synopsis="A quiet town discovers a secret."
        actions={<button type="button">Play</button>}
        aside={<span>★ 7.8</span>}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Season 2' })).toBeInTheDocument()
    expect(screen.getByText('Northern Line')).toBeInTheDocument()
    expect(screen.getByText('Change begins with a whisper.')).toBeInTheDocument()
    expect(screen.getByText('2h 22m')).toBeInTheDocument()
    expect(screen.getByText('A quiet town discovers a secret.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByText('★ 7.8')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back' })).toBeInTheDocument()
    expect(screen.getByRole('term')).toHaveTextContent('Genre')
  })

  it('renders only the title and actions when the optional blocks are absent', () => {
    const { container } = render(
      <DetailHeader
        backdrop={BACKDROP}
        metadata={[]}
        title="Everlight"
        actions={<button type="button">Play</button>}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Everlight' })).toBeInTheDocument()
    expect(container.querySelectorAll('p')).toHaveLength(0)
    expect(screen.queryByRole('term')).not.toBeInTheDocument()
  })

  it('separates meta line entries with a dot the screen reader skips', () => {
    render(<DetailHeader backdrop={BACKDROP} metadata={[]} title="Everlight" metaLine={['2024', 'PG-13']} actions={null} />)
    const separators = screen.getAllByText('•')
    expect(separators).toHaveLength(1)
    expect(separators[0]).toHaveAttribute('aria-hidden', 'true')
  })
})
