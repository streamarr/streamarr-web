import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MediaImage } from './MediaImage'

vi.mock('./blurhash', () => ({
  decodeBlurHashToDataUrl: (hash: string) => `data:mock;${hash}`,
}))

describe('MediaImage', () => {
  const image = { url: 'poster.jpg', aspectRatio: 1.5 }

  it('renders the blurHash placeholder behind the real image before it loads', () => {
    render(<MediaImage image={image} blurHash="HASH1" alt="Northern Line" />)
    expect(screen.getByTestId('blur-placeholder')).toHaveAttribute('src', 'data:mock;HASH1')
    expect(screen.getByAltText('Northern Line')).toBeInTheDocument()
  })

  it('removes the placeholder once the real image loads', () => {
    render(<MediaImage image={image} blurHash="HASH1" alt="Northern Line" />)
    fireEvent.load(screen.getByAltText('Northern Line'))
    expect(screen.queryByTestId('blur-placeholder')).not.toBeInTheDocument()
  })

  it('renders no placeholder when there is no blurHash', () => {
    render(<MediaImage image={image} blurHash={null} alt="Northern Line" />)
    expect(screen.queryByTestId('blur-placeholder')).not.toBeInTheDocument()
  })

  it('falls back to the diagonal-stripe background when there is no image and no blurHash', () => {
    render(<MediaImage image={null} blurHash={null} alt="Northern Line" />)
    expect(screen.queryByTestId('blur-placeholder')).not.toBeInTheDocument()
    expect(screen.queryByAltText('Northern Line')).not.toBeInTheDocument()
  })
})
