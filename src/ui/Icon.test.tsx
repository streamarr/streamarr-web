import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon } from './Icon'

describe('Icon', () => {
  it('shouldFillThePlayGlyphAndOutlineTheRest', () => {
    const { container } = render(
      <>
        <Icon name="play" />
        <Icon name="arrow-left" />
      </>,
    )

    const [play, back] = container.querySelectorAll('svg')
    expect(play).toHaveAttribute('fill', 'currentColor')
    expect(back).toHaveAttribute('fill', 'none')
  })
})
