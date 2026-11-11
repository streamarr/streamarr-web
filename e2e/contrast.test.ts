import { describe, expect, it } from 'vitest'
import { contrast, textContrast } from './contrast'

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

const SELECTION_BLUE = 'rgb(18, 85, 122)'
const OPAQUE = '1'

describe('textContrast', () => {
  it('shouldCompositeTranslucentTextOntoItsBackgroundWhenTheTextHasAlpha', () => {
    const ratio = textContrast({
      color: 'rgba(255, 255, 255, 0.32)',
      layers: [{ background: SELECTION_BLUE, opacity: OPAQUE }],
    })

    // White at 32% over #12557a is (93.84, 139.4, 164.56).
    expect(ratio).toBeCloseTo(contrast([93.84, 139.4, 164.56], [18, 85, 122]), 10)
    expect(ratio).toBeCloseTo(2.2, 2)
  })

  it('shouldJudgeAgainstTheNearestOpaqueBackgroundWhenNearerOnesAreTransparent', () => {
    const ratio = textContrast({
      color: 'rgb(255, 255, 255)',
      layers: [
        { background: 'rgba(0, 0, 0, 0)', opacity: OPAQUE },
        { background: SELECTION_BLUE, opacity: OPAQUE },
        { background: 'rgb(255, 255, 255)', opacity: OPAQUE },
      ],
    })

    expect(ratio).toBeCloseTo(contrast(WHITE, [18, 85, 122]), 10)
  })

  it('shouldCompositeATranslucentBackgroundOntoTheOpaqueOneBehindIt', () => {
    const ratio = textContrast({
      color: 'rgb(255, 255, 255)',
      layers: [
        { background: 'rgba(255, 255, 255, 0.07)', opacity: OPAQUE },
        { background: 'rgb(27, 30, 36)', opacity: OPAQUE },
      ],
    })

    // White at 7% over #1b1e24 is (42.96, 45.75, 51.33).
    expect(ratio).toBeCloseTo(contrast(WHITE, [42.96, 45.75, 51.33]), 10)
  })

  it('shouldRefuseToAnswerWhenNoBackgroundIsOpaque', () => {
    const painted = {
      color: 'rgb(255, 255, 255)',
      layers: [{ background: 'rgba(18, 85, 122, 0.5)', opacity: OPAQUE }],
    }

    expect(() => textContrast(painted)).toThrow('opaque background')
  })

  it('shouldRefuseToAnswerWhenALayerIsSeeThroughAsAWhole', () => {
    const painted = {
      color: 'rgb(255, 255, 255)',
      layers: [{ background: SELECTION_BLUE, opacity: '0.6' }],
    }

    expect(() => textContrast(painted)).toThrow('opacity 0.6')
  })

  it('shouldRefuseToAnswerWhenAColorIsNotInRgbNotation', () => {
    const painted = {
      color: 'color(srgb 1 1 1)',
      layers: [{ background: SELECTION_BLUE, opacity: OPAQUE }],
    }

    expect(() => textContrast(painted)).toThrow('color(srgb 1 1 1)')
  })
})
