import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors'
import { describe, expect, it } from 'vitest'
import { hasInvalidInputAt, requestFailureMessage } from './requestErrors'

const FALLBACK = "Couldn't load your library."

describe('requestFailureMessage', () => {
  it('shouldShowTheServersSentenceWhenTheErrorCarriesACode', () => {
    const error = new CombinedGraphQLErrors({
      errors: [
        {
          message: ' Library storage is offline. ',
          extensions: { errorType: 'UNAVAILABLE', code: 'UNAVAILABLE', requestId: 'r-1' },
        },
      ],
    })

    expect(requestFailureMessage(error, FALLBACK)).toBe('Library storage is offline.')
  })

  it('shouldFallBackWhenNoErrorCarriesACode', () => {
    const error = new CombinedGraphQLErrors({
      errors: [
        {
          message:
            "The field at path '/library' was declared as a non null type, but the code involved in retrieving data has wrongly returned a null value.",
          path: ['library'],
        },
      ],
    })

    expect(requestFailureMessage(error, FALLBACK)).toBe(FALLBACK)
  })

  it('shouldFallBackForTheSanitizedInternalError', () => {
    const error = new CombinedGraphQLErrors({
      errors: [
        {
          message: 'The request could not be completed.',
          extensions: { errorType: 'INTERNAL', code: 'INTERNAL', requestId: 'r-2' },
        },
      ],
    })

    expect(requestFailureMessage(error, FALLBACK)).toBe(FALLBACK)
  })

  it('shouldFallBackWhenACodedErrorHasNoSentence', () => {
    const error = new CombinedGraphQLErrors({
      errors: [{ message: '  ', extensions: { code: 'UNAVAILABLE' } }],
    })

    expect(requestFailureMessage(error, FALLBACK)).toBe(FALLBACK)
  })

  it('shouldFallBackForANetworkFailure', () => {
    const error = new ServerError('Response not successful: Received status code 502', {
      response: new Response('Bad gateway', { status: 502 }),
      bodyText: 'Bad gateway',
    })

    expect(requestFailureMessage(error, FALLBACK)).toBe(FALLBACK)
    expect(requestFailureMessage(new TypeError('Failed to fetch'), FALLBACK)).toBe(FALLBACK)
  })
})

describe('hasInvalidInputAt', () => {
  const invalidId = new CombinedGraphQLErrors({
    errors: [
      {
        message: 'Invalid ID format: abc',
        path: ['movie'],
        extensions: { errorType: 'BAD_REQUEST', code: 'INVALID_INPUT', requestId: 'r-3' },
      },
    ],
  })

  it('shouldRecognizeTheServerRejectingTheRootFieldsInput', () => {
    expect(hasInvalidInputAt(invalidId, 'movie')).toBe(true)
  })

  it('shouldIgnoreARejectionOfAnotherField', () => {
    expect(hasInvalidInputAt(invalidId, 'library')).toBe(false)
  })

  it('shouldIgnoreOtherFailures', () => {
    const unavailable = new CombinedGraphQLErrors({
      errors: [{ message: 'offline', path: ['movie'], extensions: { code: 'UNAVAILABLE' } }],
    })

    expect(hasInvalidInputAt(unavailable, 'movie')).toBe(false)
    expect(hasInvalidInputAt(new TypeError('Failed to fetch'), 'movie')).toBe(false)
  })
})
