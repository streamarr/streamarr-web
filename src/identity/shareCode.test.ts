import { describe, expect, it } from 'vitest'
import { shareCodeIn } from './shareCode'

describe('shareCodeIn', () => {
  it.each([
    'BCDF-GHJK',
    'bcdfghjk',
    ' bcdf ghjk ',
    'Bcdf-Ghjk\n',
    'BC DF-GH JK',
    'https://streamarr.example/settings/profile/sharing?code=BCDF-GHJK',
    ' https://streamarr.example/settings/profile/sharing?code=bcdfghjk ',
  ])('shouldReadTheCodeWhenTheTextCanBeOne(%j)', (text) => {
    expect(shareCodeIn(text)).toBe('BCDFGHJK')
  })

  it.each([
    '',
    '   ',
    'BCDF-GHJ',
    'BCDF-GHJKL',
    'BCDF-GHJ1',
    'the Smiths',
    '55555555-5555-5555-5555-555555555555',
    'https://streamarr.example/settings/profile/sharing',
    'https://streamarr.example/settings/profile/sharing?code=BCDF',
  ])('shouldReadNoCodeWhenTheTextCannotBeOne(%j)', (text) => {
    expect(shareCodeIn(text)).toBeNull()
  })
})
