import { describe, expect, it } from 'vitest'
import { expiryLabel } from './shareText'

const NOW = new Date('2026-08-20T12:00:00Z')

describe('expiryLabel', () => {
  it.each([
    ['2026-08-27T12:00:00Z', 'Expires in 7 days'],
    ['2026-08-27T11:59:55Z', 'Expires in 7 days'],
    ['2026-08-26T21:00:00Z', 'Expires in 6 days'],
    ['2026-08-21T13:00:00Z', 'Expires in 1 day'],
    ['2026-08-21T11:40:00Z', 'Expires in 1 day'],
    ['2026-08-21T11:00:00Z', 'Expires in 23 hours'],
    ['2026-08-20T15:00:00Z', 'Expires in 3 hours'],
    ['2026-08-20T14:59:59Z', 'Expires in 3 hours'],
    ['2026-08-20T13:20:00Z', 'Expires in 1 hour'],
    ['2026-08-20T12:59:40Z', 'Expires in 1 hour'],
    ['2026-08-20T12:20:00Z', 'Expires in 20 minutes'],
    ['2026-08-20T12:00:20Z', 'Expires in 1 minute'],
  ])('shouldSayHowLongIsLeftToTheNearestWholeUnitWhenTheTimeIsAhead(%s)', (expiresAt, label) => {
    expect(expiryLabel(expiresAt, NOW)).toBe(label)
  })

  it('shouldSayExpiredWhenTheTimeHasPassed', () => {
    expect(expiryLabel('2026-08-20T11:59:00Z', NOW)).toBe('Expired')
  })
})
