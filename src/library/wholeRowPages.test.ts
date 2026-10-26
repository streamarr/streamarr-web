import { describe, expect, it } from 'vitest'
import { pageSizeAfter, pageSizeBefore, titlesBeforeLetter } from './wholeRowPages'

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

describe('titlesBeforeLetter', () => {
  const index = [
    { letter: 'A', count: 3 },
    { letter: 'HASH', count: 2 },
    { letter: 'C', count: 5 },
    { letter: 'M', count: 7 },
  ]

  it('shouldCountTheTitlesUnderEarlierLettersAndHashWhenAscending', () => {
    expect(titlesBeforeLetter({ index, letter: 'M', direction: 'ASC' })).toBe(10)
    expect(titlesBeforeLetter({ index, letter: 'HASH', direction: 'ASC' })).toBe(0)
  })

  it('shouldCountTheTitlesUnderLaterLettersWhenDescending', () => {
    expect(titlesBeforeLetter({ index, letter: 'C', direction: 'DESC' })).toBe(7)
    expect(titlesBeforeLetter({ index, letter: 'HASH', direction: 'DESC' })).toBe(15)
  })
})
