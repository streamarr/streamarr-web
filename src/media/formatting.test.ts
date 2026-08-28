import { describe, expect, it } from 'vitest'
import { formatRelativeTime, formatRuntime, formatTimeLeft, formatYear } from './formatting'

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

describe('formatTimeLeft', () => {
  it('formats the remaining runtime as minutes left', () => {
    expect(formatTimeLeft({ positionSeconds: 1620, durationSeconds: 3060 })).toBe('24m left')
  })

  it('never goes negative when position exceeds duration', () => {
    expect(formatTimeLeft({ positionSeconds: 3100, durationSeconds: 3060 })).toBe('0m left')
  })
})
