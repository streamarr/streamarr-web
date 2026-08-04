import { afterEach, describe, expect, it } from 'vitest'
import { isCsrfRejection, readCsrfCookie } from './csrf'

function setDocumentCookies(cookies: string): void {
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    value: cookies,
  })
}

describe('csrf cookie reader', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'cookie')
  })

  it('shouldExerciseProductionCookieRulesFromAnHttpsOrigin', () => {
    expect(window.location.protocol).toBe('https:')
  })

  it('shouldReadHostBoundCsrfCookie', () => {
    setDocumentCookies('__Host-XSRF-TOKEN=host-token')

    expect(readCsrfCookie()).toBe('host-token')
  })

  it('shouldPreferHostBoundCsrfCookieWhenBothNamesExist', () => {
    setDocumentCookies(
      'XSRF-TOKEN=development-token; __Host-XSRF-TOKEN=host-token',
    )

    expect(readCsrfCookie()).toBe('host-token')
  })

  it('shouldReadUnprefixedCsrfCookieAsDevelopmentFallback', () => {
    setDocumentCookies('XSRF-TOKEN=development-token')

    expect(readCsrfCookie()).toBe('development-token')
  })

  it('shouldIgnoreMalformedEncodedCookieValue', () => {
    setDocumentCookies('__Host-XSRF-TOKEN=%not-encoded')

    expect(readCsrfCookie()).toBeNull()
  })
})

describe('csrf rejection classifier', () => {
  it('shouldRecognizeCsrfRejectionWhenStatusAndCodeMatch', () => {
    expect(isCsrfRejection(403, 'CSRF_TOKEN_REQUIRED')).toBe(true)
  })

  it('shouldNotRecognizeCsrfRejectionWhenCodeDiffers', () => {
    expect(isCsrfRejection(403, 'FORBIDDEN')).toBe(false)
  })

  it('shouldNotRecognizeCsrfRejectionWhenStatusDiffers', () => {
    expect(isCsrfRejection(401, 'CSRF_TOKEN_REQUIRED')).toBe(false)
  })
})
