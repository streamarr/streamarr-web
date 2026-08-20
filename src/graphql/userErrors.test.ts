import { describe, expect, it } from 'vitest'
import { FORM_ERRORS, groupByInputPath, userErrorMessage } from './userErrors'

describe('userErrorMessage', () => {
  it('prefers the member message and falls back for unknown members', () => {
    expect(userErrorMessage({ __typename: 'NameRequiredError', message: 'Enter a name.' })).toBe(
      'Enter a name.',
    )
    expect(userErrorMessage({ __typename: 'BrandNewError' })).toBe(
      'Something went wrong. Please try again.',
    )
    expect(userErrorMessage({ message: '   ' })).toBe('Something went wrong. Please try again.')
    expect(userErrorMessage(undefined)).toBe('Something went wrong. Please try again.')
  })
})

describe('groupByInputPath', () => {
  it('groups by dotted path and keeps path-less members under the form', () => {
    const grouped = groupByInputPath([
      { message: 'Enter a name.', inputPath: ['name'] },
      { message: 'Pick a shorter one.', inputPath: ['name'] },
      { message: 'No such Household.', inputPath: ['finalAccount', 'destinationHouseholdId'] },
      { message: 'Confirm your password to continue.' },
    ])

    expect(grouped.get('name')).toHaveLength(2)
    expect(grouped.get('finalAccount.destinationHouseholdId')).toHaveLength(1)
    expect(grouped.get(FORM_ERRORS)?.[0]?.message).toBe('Confirm your password to continue.')
    expect(groupByInputPath(undefined).size).toBe(0)
  })
})
