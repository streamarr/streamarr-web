import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressDivider } from './ProgressDivider'

describe('ProgressDivider', () => {
  it('fills the bar to the watched share and rides the count badge on it', () => {
    render(<ProgressDivider watched={7} total={10} />)
    const bar = screen.getByRole('progressbar', { name: '7 of 10 watched' })
    expect(bar).toHaveAttribute('aria-valuenow', '7')
    expect(bar).toHaveAttribute('aria-valuemax', '10')
    expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '70%' })
    expect(screen.getByText('7 of 10 watched')).toBeInTheDocument()
  })

  it('renders a plain separator with no badge when nothing has been watched', () => {
    render(<ProgressDivider watched={0} total={12} />)
    expect(screen.getByRole('progressbar', { name: '0 of 12 watched' })).toHaveAttribute('aria-valuenow', '0')
    expect(screen.queryByText('0 of 12 watched')).not.toBeInTheDocument()
  })

  it('renders nothing when there is nothing to count', () => {
    const { container } = render(<ProgressDivider watched={0} total={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})
