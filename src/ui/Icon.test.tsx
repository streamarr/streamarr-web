import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon } from './Icon'

describe('Icon', () => {
  it('shouldFillThePlayAndPauseGlyphsAndOutlineTheRest', () => {
    const { container } = render(
      <>
        <Icon name="play" />
        <Icon name="pause" />
        <Icon name="arrow-left" />
      </>,
    )

    const [play, pause, back] = container.querySelectorAll('svg')
    expect(play).toHaveAttribute('fill', 'currentColor')
    expect(pause).toHaveAttribute('fill', 'currentColor')
    expect(back).toHaveAttribute('fill', 'none')
  })
})
