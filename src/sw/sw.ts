/// <reference lib="webworker" />
// Thin event-listener adapter over the pure functions in decisions.ts. Registered with
// { type: 'module' }. Best-effort by design: on any internal failure the network response
// flows through unchanged and the page's error handling takes over.
import { decideIntercept, isExpiredTokenResponse, SingleFlight } from './decisions'

declare const self: ServiceWorkerGlobalScope

const refreshFlight = new SingleFlight<boolean>()
let csrfToken: string | null = null
let renewalTimer: ReturnType<typeof setTimeout> | undefined

const RENEWAL_LEEWAY_MS = 30_000

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// The page posts the script-readable XSRF-TOKEN cookie and access-token expiry here —
// the worker cannot read httpOnly cookies, and expiry only travels in response bodies.
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string; token?: string; expiresAt?: string } | null
  if (data?.type === 'csrf' && typeof data.token === 'string') {
    csrfToken = data.token
  }
  if (data?.type === 'schedule-renewal' && typeof data.expiresAt === 'string') {
    scheduleRenewal(data.expiresAt)
  }
})

self.addEventListener('fetch', (event) => {
  if (decideIntercept(event.request.url, self.location.origin) !== 'intercept') {
    return
  }
  event.respondWith(fetchWithRefresh(event.request))
})

/** Reactive path: on EXPIRED_TOKEN, run the single-flight refresh and replay once. */
async function fetchWithRefresh(request: Request): Promise<Response> {
  const replayable = request.clone()
  const response = await fetch(request)

  if (!(await isExpired(response))) {
    return response
  }

  const refreshed = await refreshFlight.run(postRefresh).catch(() => false)
  if (!refreshed) {
    // Let the 401 through: the page routes to login.
    return response
  }
  return fetch(replayable)
}

async function isExpired(response: Response): Promise<boolean> {
  if (response.status !== 401) {
    return false
  }
  try {
    const body: unknown = await response.clone().json()
    return isExpiredTokenResponse(response.status, body)
  } catch {
    return false
  }
}

async function postRefresh(): Promise<boolean> {
  const headers: HeadersInit = csrfToken ? { 'X-XSRF-TOKEN': csrfToken } : {}
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
  })
  return response.ok
}

/**
 * Proactive path, best-effort only: browsers kill idle workers, so the timer may never fire.
 * The reactive path above is the correctness guarantee.
 */
function scheduleRenewal(expiresAt: string): void {
  clearTimeout(renewalTimer)
  const delay = new Date(expiresAt).getTime() - Date.now() - RENEWAL_LEEWAY_MS
  if (Number.isNaN(delay) || delay <= 0) {
    return
  }
  renewalTimer = setTimeout(() => {
    void refreshFlight.run(postRefresh).catch(() => false)
  }, delay)
}
