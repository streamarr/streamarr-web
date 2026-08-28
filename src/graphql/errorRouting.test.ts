import { describe, expect, it } from 'vitest'
import { decideAuthRoute, extractAuthContext } from './errorRouting'

describe('decideAuthRoute', () => {
  it('shouldRouteToLoginOnAuthenticationRequired', () => {
    expect(decideAuthRoute({ networkStatus: 401, networkCode: 'AUTHENTICATION_REQUIRED' })).toBe(
      '/login',
    )
  })

  it('shouldRouteToLoginOnAuthenticationRequiredAsAGraphqlError', () => {
    expect(decideAuthRoute({ graphqlCodes: ['AUTHENTICATION_REQUIRED'] })).toBe('/login')
  })

  it('shouldRouteToLoginOnInvalidToken', () => {
    expect(decideAuthRoute({ networkStatus: 401, networkCode: 'INVALID_TOKEN' })).toBe('/login')
  })

  it('shouldRouteToSelectOnProfileOrHouseholdRequired', () => {
    expect(decideAuthRoute({ graphqlCodes: ['PROFILE_REQUIRED'] })).toBe('/select-profile')
    expect(decideAuthRoute({ graphqlCodes: ['HOUSEHOLD_REQUIRED'] })).toBe('/select-profile')
  })

  it('shouldNotRouteOnExpiredToken', () => {
    // The service worker renews and replays EXPIRED_TOKEN itself.
    expect(decideAuthRoute({ networkStatus: 401, networkCode: 'EXPIRED_TOKEN' })).toBeNull()
  })

  it('shouldNotRouteOnUnrelatedErrors', () => {
    expect(decideAuthRoute({ networkStatus: 500, networkCode: null })).toBeNull()
    expect(decideAuthRoute({ graphqlCodes: ['NOT_FOUND'] })).toBeNull()
    expect(decideAuthRoute({})).toBeNull()
  })
})

describe('extractAuthContext', () => {
  it('shouldExtractGraphqlExtensionCodes', () => {
    const error = { errors: [{ extensions: { code: 'PROFILE_REQUIRED' } }] }
    expect(extractAuthContext(error)).toEqual({ graphqlCodes: ['PROFILE_REQUIRED'] })
  })

  it('shouldExtractNetworkStatusAndBodyCode', () => {
    const error = { statusCode: 401, bodyText: '{"code":"AUTHENTICATION_REQUIRED"}' }
    expect(extractAuthContext(error)).toEqual({
      networkStatus: 401,
      networkCode: 'AUTHENTICATION_REQUIRED',
    })
  })

  it('shouldTolerateNonJsonBodyAndUnknownErrors', () => {
    expect(extractAuthContext({ statusCode: 502, bodyText: '<html>bad gateway' })).toEqual({
      networkStatus: 502,
      networkCode: null,
    })
    expect(extractAuthContext(null)).toEqual({})
    expect(extractAuthContext('boom')).toEqual({})
  })

  it('shouldRouteFromAnExtractedNetworkError', () => {
    const error = { statusCode: 401, bodyText: '{"code":"INVALID_TOKEN"}' }
    expect(decideAuthRoute(extractAuthContext(error))).toBe('/login')
  })
})
