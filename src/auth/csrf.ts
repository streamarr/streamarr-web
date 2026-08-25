// Script-readable by design: the page echoes it and hands it to the service worker for its own
// refresh POSTs. Names match AuthCookies in streamarr-server; the unprefixed one is dev-only.

export function readCsrfCookie(): string | null {
  const value = readCookie('__Host-XSRF-TOKEN') ?? readCookie('XSRF-TOKEN')
  if (value === null) {
    return null
  }
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`
  const value = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length)
  return value ? value : null
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

/** Read per request: the server may replace the cookie. Empty until a token has been issued. */
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
