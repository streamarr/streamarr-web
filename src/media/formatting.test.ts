import { describe, expect, it } from 'vitest'
import {
  formatEpisodeLabel,
  formatLongDate,
  formatRelativeTime,
  formatRuntime,
  formatTimeLeft,
  formatYear,
} from './formatting'

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-28T12:00:00Z')

  it('reads "just now" under a minute', () => {
    expect(formatRelativeTime('2026-08-28T11:59:31Z', now)).toBe('just now')
  })

  it('reads minutes ago under an hour', () => {
    expect(formatRelativeTime('2026-08-28T11:46:00Z', now)).toBe('14 minutes ago')
  })

  it('reads singular for exactly one minute', () => {
    expect(formatRelativeTime('2026-08-28T11:59:00Z', now)).toBe('1 minute ago')
  })

  it('reads hours ago under a day', () => {
    expect(formatRelativeTime('2026-08-28T09:00:00Z', now)).toBe('3 hours ago')
  })

  it('reads days ago under a week', () => {
    expect(formatRelativeTime('2026-08-26T12:00:00Z', now)).toBe('2 days ago')
  })

  it('reads weeks ago beyond a week', () => {
    expect(formatRelativeTime('2026-08-10T12:00:00Z', now)).toBe('2 weeks ago')
  })
})

describe('formatRuntime', () => {
  it('formats under an hour as bare minutes', () => {
    expect(formatRuntime(39)).toBe('39m')
  })

  it('formats an hour or more with zero-padded minutes', () => {
    expect(formatRuntime(142)).toBe('2h 22m')
  })

  it('zero-pads a whole number of hours', () => {
    expect(formatRuntime(120)).toBe('2h 00m')
  })
})

describe('formatYear', () => {
  it('extracts the year from an ISO date', () => {
    expect(formatYear('2024-03-15')).toBe('2024')
  })

  it('returns null for a missing date', () => {
    expect(formatYear(null)).toBeNull()
    expect(formatYear(undefined)).toBeNull()
  })
})

describe('formatLongDate', () => {
  it('reads day, short month, year regardless of the viewer locale', () => {
    expect(formatLongDate('2021-12-10')).toBe('10 Dec 2021')
  })

  it('yields null for a missing or unparseable date', () => {
    expect(formatLongDate(null)).toBeNull()
    expect(formatLongDate('soon')).toBeNull()
  })
})

describe('formatEpisodeLabel', () => {
  it('reads S{season} E{episode} with no zero padding, per the copy rules', () => {
    expect(formatEpisodeLabel(2, 5)).toBe('S2 E5')
    expect(formatEpisodeLabel(12, 10)).toBe('S12 E10')
  })
})

describe('formatTimeLeft', () => {
  it('formats the remaining runtime as minutes left', () => {
    expect(formatTimeLeft({ positionSeconds: 1620, durationSeconds: 3060 })).toBe('24m left')
  })

  it('never goes negative when position exceeds duration', () => {
    expect(formatTimeLeft({ positionSeconds: 3100, durationSeconds: 3060 })).toBe('0m left')
  })
})
