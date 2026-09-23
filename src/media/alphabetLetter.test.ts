import { describe, expect, it } from 'vitest'
import { alphabetLetterFromTitle } from './alphabetLetter'

describe('alphabetLetterFromTitle', () => {
  it('buckets a plain title by its first letter', () => {
    expect(alphabetLetterFromTitle('Northern Line')).toBe('N')
  })

  it('folds diacritics before bucketing', () => {
    expect(alphabetLetterFromTitle('Émile')).toBe('E')
  })

  it('is case-insensitive', () => {
    expect(alphabetLetterFromTitle('everlight')).toBe('E')
  })

  it('falls back to HASH for a non-alphabetic title', () => {
    expect(alphabetLetterFromTitle('9 to 5')).toBe('HASH')
    expect(alphabetLetterFromTitle('$100')).toBe('HASH')
  })

  it('falls back to HASH for an empty title', () => {
    expect(alphabetLetterFromTitle('')).toBe('HASH')
  })
})
