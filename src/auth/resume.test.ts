import { describe, expect, it } from 'vitest'
import { sanitizeResumeTarget } from './resume'

describe('sanitizeResumeTarget', () => {
  it('shouldKeepAnInAppHref', () => {
    expect(sanitizeResumeTarget('/link')).toBe('/link')
    expect(sanitizeResumeTarget('/play/abc?x=1')).toBe('/play/abc?x=1')
    expect(sanitizeResumeTarget('/')).toBe('/')
  })

  it('shouldRefuseAnAbsoluteUrl', () => {
    expect(sanitizeResumeTarget('https://evil.example/phish')).toBeUndefined()
    expect(sanitizeResumeTarget('javascript:alert(1)')).toBeUndefined()
  })

  it('shouldRefuseAProtocolRelativeUrl', () => {
    expect(sanitizeResumeTarget('//evil.example/phish')).toBeUndefined()
  })

  it('shouldRefuseBackslashSmuggling', () => {
    // Browsers resolve '/\evil.example' as protocol-relative.
    expect(sanitizeResumeTarget('/\\evil.example')).toBeUndefined()
  })

  it('shouldRefuseAnythingButAString', () => {
    expect(sanitizeResumeTarget(undefined)).toBeUndefined()
    expect(sanitizeResumeTarget(42)).toBeUndefined()
    expect(sanitizeResumeTarget(['/link'])).toBeUndefined()
  })
})
