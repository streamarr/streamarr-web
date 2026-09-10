import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ContentShelf } from './ContentShelf'

describe('ContentShelf', () => {
  it('renders the title, count, and children', () => {
    render(
      <ContentShelf title="Continue watching" count="4 in progress">
        <div>Card</div>
      </ContentShelf>,
    )
    expect(screen.getByText('Continue watching')).toBeInTheDocument()
    expect(screen.getByText('4 in progress')).toBeInTheDocument()
    expect(screen.getByText('Card')).toBeInTheDocument()
  })

  it('renders no count element when none is given', () => {
    render(
      <ContentShelf title="Continue watching">
        <div>Card</div>
      </ContentShelf>,
    )
    expect(screen.queryByText(/in progress/)).not.toBeInTheDocument()
  })

  it('scrolls one visible shelf width in either direction, including after a resize', async () => {
    const user = userEvent.setup()
    render(
      <ContentShelf title="Continue watching">
        <div>Card</div>
      </ContentShelf>,
    )
    const track = screen.getByText('Card').parentElement!
    const width = vi.spyOn(track, 'clientWidth', 'get').mockReturnValue(320)
    const scrollBy = vi.fn()
    Object.defineProperty(track, 'scrollBy', { value: scrollBy, configurable: true })

    await user.click(screen.getByLabelText('Scroll right'))
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 320, behavior: 'smooth' })

    width.mockReturnValue(720)
    await user.click(screen.getByLabelText('Scroll left'))
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -720, behavior: 'smooth' })
  })
})
