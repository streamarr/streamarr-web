import { describe, expect, it } from 'vitest'
import { fittingChipCount } from './chipFit'

// An All chip of 60px, chips of 100px and 64px, 8px between chips, and an 88px "more" chip.
const BAR = { gap: 8, first: 60, chips: [100, 64], more: 88 } as const

describe('fittingChipCount', () => {
  it('shouldShowEveryChipWhenAllOfThemFitWithoutTheMoreChip', () => {
    expect(fittingChipCount({ ...BAR, available: 240 })).toBe(2)
  })

  it('shouldKeepRoomForTheMoreChipWhenAnyChipIsLeftOut', () => {
    expect(fittingChipCount({ ...BAR, available: 239 })).toBe(0)
    expect(
      fittingChipCount({ ...BAR, gap: 8, first: 60, chips: [100, 64, 64], available: 280 }),
    ).toBe(1)
  })

  it('shouldShowNoChipWhenEvenTheFirstOneLeavesNoRoom', () => {
    expect(fittingChipCount({ ...BAR, available: 100 })).toBe(0)
  })
})
