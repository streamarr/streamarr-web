// The CSRF cookie is deliberately script-readable; the page reads it and hands it to the service
// worker, which attaches it to its own refresh POSTs. Secure deployments use the host-bound name.
// The unprefixed name is reserved for the development profile proposed by streamarr-server #266.
// The wire-contract counterpart is AuthCookies in streamarr-server.

export function readCsrfCookie(): string | null {
  const match =
    document.cookie.match(/(?:^|;\s*)__Host-XSRF-TOKEN=([^;]+)/) ??
    document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)
  if (!match) {
    return null
  }
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

export const CSRF_HEADER = 'X-XSRF-TOKEN'
export const CSRF_REJECTION_CODE = 'CSRF_TOKEN_REQUIRED'
export const CSRF_REJECTION_MESSAGE =
  'Your session security check failed. Reload the page and try again.'

export function isCsrfRejection(
  status: number | undefined,
  code: string | null | undefined,
): boolean {
  return status === 403 && code === CSRF_REJECTION_CODE
}

/**
 * The double-submit echo every cookie-mode unsafe request carries — read per request, since the
 * server may replace the cookie. Empty until the server has issued a token: there is nothing to
 * echo yet.
 */
export function csrfHeaders(): Record<string, string> {
  const token = readCsrfCookie()
  return token ? { [CSRF_HEADER]: token } : {}
}

export function postCsrfTokenToServiceWorker(): void {
  const token = readCsrfCookie()
  if (token && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'csrf', token })
  }
}
