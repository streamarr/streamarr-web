import { describe, expect, it } from 'vitest'
import { expiryLabel, householdIdIn, shortId } from './shareText'

const NOW = new Date('2026-08-20T12:00:00Z')

describe('expiryLabel', () => {
  it.each([
    ['2026-08-27T12:00:00Z', 'Expires in 7 days'],
    ['2026-08-21T13:00:00Z', 'Expires in 1 day'],
    ['2026-08-21T11:00:00Z', 'Expires in 23 hours'],
    ['2026-08-20T13:30:00Z', 'Expires in 1 hour'],
    ['2026-08-20T12:20:00Z', 'Expires in 20 minutes'],
    ['2026-08-20T12:00:20Z', 'Expires in 1 minute'],
  ])('shouldSayHowLongIsLeftInTheLargestWholeUnit(%s)', (expiresAt, label) => {
    expect(expiryLabel(expiresAt, NOW)).toBe(label)
  })

  it('shouldSayExpiredWhenTheTimeHasPassed', () => {
    expect(expiryLabel('2026-08-20T11:59:00Z', NOW)).toBe('Expired')
  })
})

describe('shortId', () => {
  it('shouldGiveTheStartOfAnId', () => {
    expect(shortId('33333333-3333-3333-3333-333333333333')).toBe('33333333')
  })
})

describe('householdIdIn', () => {
  const ID = '55555555-aaaa-4bbb-8ccc-0123456789ab'

  it.each([ID, `  ${ID}\n`, `id: "${ID}",`, `Our Household is ${ID}.`])(
    'shouldFindTheIdWhenTheTextHoldsOne(%j)',
    (text) => {
      expect(householdIdIn(text)).toBe(ID)
    },
  )

  it.each(['', 'the Smiths', ID.slice(0, 30), `${ID}0`, `f${ID}`])(
    'shouldFindNoIdWhenTheTextHoldsNone(%j)',
    (text) => {
      expect(householdIdIn(text)).toBeNull()
    },
  )
})
