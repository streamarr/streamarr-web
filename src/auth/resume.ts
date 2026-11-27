export interface ResumeSearch {
  redirect?: string
}

/**
 * The ?redirect= target is untrusted: only an in-app href survives. '//' is protocol-relative,
 * and browsers normalize backslashes to slashes — '/\evil.example' is '//evil.example' in disguise.
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

/**
 * The way to the sign-in page from `location`, which resumes there once the visitor signs in. The
 * path and query ride in ?redirect=. The fragment rides as the sign-in page's own fragment, so
 * what it carries, such as a share code, never enters a query string, which a server can log.
 */
export function signInResuming(location: { href: string; hash: string }) {
  const fragmentAt = location.href.indexOf('#')
  const redirect = fragmentAt === -1 ? location.href : location.href.slice(0, fragmentAt)
  return { to: '/login' as const, search: { redirect }, hash: location.hash }
}
