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

export function postCsrfTokenToServiceWorker(): void {
  const token = readCsrfCookie()
  if (token && navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'csrf', token })
  }
}

export function scheduleTokenRenewal(expiresAt: string): void {
  navigator.serviceWorker?.controller?.postMessage({ type: 'schedule-renewal', expiresAt })
}
