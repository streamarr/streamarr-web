import { describe, expect, it } from 'vitest'
import { fullTime, nextLabelChange, whenLabel } from './notificationTime'

const NOW = new Date(2026, 10, 11, 15, 0)
const before = (milliseconds: number) => new Date(NOW.getTime() - milliseconds).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('whenLabel', () => {
  it.each([
    ['a moment ago', before(20_000), 'Just now'],
    ['a clock a little ahead of this one', before(-5_000), 'Just now'],
    ['a minute ago', before(MINUTE), '1 minute ago'],
    ['under an hour ago', before(59 * MINUTE + 59_000), '59 minutes ago'],
    ['an hour ago', before(HOUR), '1 hour ago'],
    ['under a day ago', before(23 * HOUR + 59 * MINUTE), '23 hours ago'],
    ['a day ago', before(DAY), '1 day ago'],
    ['under a week ago', before(6 * DAY + 23 * HOUR), '6 days ago'],
  ])('shouldSayHowLongAgoWhenItHappenedWithinTheWeek: %s', (_, at, label) => {
    expect(whenLabel(at, NOW)).toBe(label)
  })

  it('shouldSayTheDateWhenItHappenedAWeekAgoOrEarlier', () => {
    expect(whenLabel(before(7 * DAY), NOW)).toBe('Nov 4, 2026')
    expect(whenLabel(new Date(2025, 0, 2, 9, 30).toISOString(), NOW)).toBe('Jan 2, 2025')
  })
})

describe('nextLabelChange', () => {
  it.each([
    ['a moment ago', before(20_000), before(20_000 - MINUTE)],
    ['a clock a little ahead of this one', before(-5_000), before(-5_000 - MINUTE)],
    ['a minute ago', before(MINUTE), before(-MINUTE)],
    ['under an hour ago', before(59 * MINUTE + 59_000), before(59_000 - MINUTE)],
    ['under a day ago', before(23 * HOUR + 30 * MINUTE), before(-30 * MINUTE)],
    ['under a week ago', before(6 * DAY + 23 * HOUR), before(-HOUR)],
  ])('shouldChangeTheLabelWhenTheNextWholeUnitHasPassed: %s', (_, at, next) => {
    expect(nextLabelChange(at, NOW)).toBe(next)
    expect(whenLabel(at, new Date(next))).not.toBe(whenLabel(at, NOW))
  })

  it('shouldChangeTheLabelNoMoreWhenItAlreadySaysTheDate', () => {
    expect(nextLabelChange(before(7 * DAY), NOW)).toBeNull()
  })
})

describe('fullTime', () => {
  it('shouldGiveTheDayDateAndTimeWhenAskedForTheFullTime', () => {
    expect(fullTime(new Date(2026, 9, 3, 14, 5).toISOString())).toMatch(
      /^Saturday, October 3, 2026 at 2:05\sPM$/,
    )
  })
})
