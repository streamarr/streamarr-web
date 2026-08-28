// Signing in can resume the destination the visitor was interrupted at. The target arrives as
// an untrusted ?redirect= search param, and echoing an arbitrary one back into a navigation is
// how open-redirect bugs get in — so only a same-app href survives validation.

export interface ResumeSearch {
  redirect?: string
}

/**
 * Keep a resume target only when it is an in-app href: an absolute path with no host and no
 * scheme. '//' is protocol-relative, and backslashes are refused because browsers normalize
 * them to slashes when resolving — '/\evil.example' is '//evil.example' in disguise.
 */
export function sanitizeResumeTarget(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return undefined
  }
  if (value.startsWith('//') || value.includes('\\')) {
    return undefined
  }
  return value
}
