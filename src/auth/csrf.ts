// The XSRF-TOKEN cookie is deliberately script-readable (CookieCsrfTokenRepository
// withHttpOnlyFalse on the server); the page reads it and hands it to the service worker,
// which attaches it to its own refresh POSTs.

export function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)
  if (!match) {
    return null
  }
  return decodeURIComponent(match[1])
}

const CSRF_HEADER = 'X-XSRF-TOKEN'

/**
 * The double-submit echo every cookie-mode unsafe request carries — read per request, since the
 * token changes when the session rotates. Empty until the server has issued a token: there is
 * nothing to echo yet.
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

export function scheduleTokenRenewal(expiresAt: string): void {
  navigator.serviceWorker?.controller?.postMessage({ type: 'schedule-renewal', expiresAt })
}
