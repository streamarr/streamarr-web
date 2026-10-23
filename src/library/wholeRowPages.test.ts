import { describe, expect, it } from 'vitest'
import { pageSizeAfter, pageSizeBefore } from './wholeRowPages'

describe('pageSizeAfter', () => {
  it('shouldAskForWholeRowsWhenTheLoadedTitlesEndARow', () => {
    expect(pageSizeAfter({ columns: 5, end: 0 })).toBe(50)
    expect(pageSizeAfter({ columns: 6, end: 48 })).toBe(48)
  })

  it('shouldFinishTheLastRowWhenTheLoadedTitlesEndPartWayThroughOne', () => {
    expect(pageSizeAfter({ columns: 5, end: 48 })).toBe(52)
    expect(pageSizeAfter({ columns: 7, end: 50 })).toBe(55)
  })

  it('shouldAskForOneRowAtATimeWhenARowHoldsMoreThanAPage', () => {
    expect(pageSizeAfter({ columns: 60, end: 0 })).toBe(60)
  })
})

describe('pageSizeBefore', () => {
  it('shouldAskForWholeRowsWhenTheLoadedTitlesStartARow', () => {
    expect(pageSizeBefore({ columns: 5, start: 100 })).toBe(50)
  })

  it('shouldFillTheFirstRowWhenTheLoadedTitlesStartPartWayThroughOne', () => {
    expect(pageSizeBefore({ columns: 5, start: 156 })).toBe(51)
  })
})
