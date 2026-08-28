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

  it('scrolls the track when an arrow is clicked', async () => {
    // jsdom doesn't implement scrollBy at all, so there's nothing for vi.spyOn to wrap.
    const scrollBy = vi.fn()
    Element.prototype.scrollBy = scrollBy
    const user = userEvent.setup()
    render(
      <ContentShelf title="Continue watching">
        <div>Card</div>
      </ContentShelf>,
    )

    await user.click(screen.getByLabelText('Scroll right'))

    expect(scrollBy).toHaveBeenCalledWith({ left: 480, behavior: 'smooth' })
  })
})
