import { describe, expect, it } from 'vitest'
import { pickImageVariant } from './images'

describe('pickImageVariant', () => {
  const image = {
    aspectRatio: 1.5,
    variants: [
      { size: 'SMALL', url: 'small.jpg' },
      { size: 'MEDIUM', url: 'medium.jpg' },
      { size: 'LARGE', url: 'large.jpg' },
    ],
  }

  it('picks the preferred size when available', () => {
    expect(pickImageVariant(image, 'MEDIUM')).toEqual({ url: 'medium.jpg', aspectRatio: 1.5 })
  })

  it('falls back to the first variant when the preferred size is missing', () => {
    expect(pickImageVariant(image, 'ORIGINAL')).toEqual({ url: 'small.jpg', aspectRatio: 1.5 })
  })

  it('ignores null entries in the variants list', () => {
    const withNulls = { aspectRatio: 2, variants: [null, { size: 'MEDIUM', url: 'medium.jpg' }, null] }
    expect(pickImageVariant(withNulls, 'MEDIUM')).toEqual({ url: 'medium.jpg', aspectRatio: 2 })
  })

  it('returns null for a missing image', () => {
    expect(pickImageVariant(null, 'MEDIUM')).toBeNull()
    expect(pickImageVariant(undefined, 'MEDIUM')).toBeNull()
  })

  it('returns null when there are no variants at all', () => {
    expect(pickImageVariant({ aspectRatio: 1, variants: [] }, 'MEDIUM')).toBeNull()
  })
})
