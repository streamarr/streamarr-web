import { describe, expect, it } from 'vitest'
import { contrast } from './contrast'

const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]

describe('contrast', () => {
  it('shouldBeTwentyOneToOneWhenWhiteMeetsBlack', () => {
    expect(contrast(WHITE, BLACK)).toBeCloseTo(21, 10)
  })

  it('shouldBeOneToOneWhenAColorMeetsItself', () => {
    expect(contrast([18, 85, 122], [18, 85, 122])).toBe(1)
  })

  it('shouldBeTheSameWhenTheColorsSwapPlaces', () => {
    expect(contrast(BLACK, WHITE)).toBe(contrast(WHITE, BLACK))
  })

  // WCAG's own example of a passing pair: #767676 on white is the darkest gray that reaches 4.5.
  it('shouldReachFourAndAHalfWhenTheDarkestPassingGrayMeetsWhite', () => {
    expect(contrast([118, 118, 118], WHITE)).toBeCloseTo(4.54, 2)
  })
})
