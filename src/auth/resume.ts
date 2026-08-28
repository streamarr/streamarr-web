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
