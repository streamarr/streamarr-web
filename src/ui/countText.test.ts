import { describe, expect, it } from 'vitest'
import { countText } from './countText'

describe('countText', () => {
  it.each([
    [0, null],
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [1200, '99+'],
  ])('shouldRead%sAs%sWhenItFollowsAMenuEntry', (count, text) => {
    expect(countText(count)).toBe(text)
  })
})
