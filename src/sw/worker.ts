import { CSRF_HEADER } from '../auth/csrf'
import { decideIntercept } from './decisions'
import { createSessionRenewal } from './sessionRenewal'

interface WorkerClient {
  postMessage(message: unknown): void
}

export interface SessionServiceWorkerScope {
  location: { origin: string }
  clients: {
    claim(): Promise<void>
    matchAll(): Promise<WorkerClient[]>
  }
  skipWaiting(): Promise<void>
  addEventListener(type: string, listener: (event: unknown) => void): void
}

interface SessionServiceWorkerDependencies {
  fetch: typeof fetch
  now: () => number
}

interface ExtendableWorkerEvent {
  waitUntil(promise: Promise<unknown>): void
}

interface MessageWorkerEvent extends ExtendableWorkerEvent {
  data: unknown
  ports?: WorkerClient[]
}

interface FetchWorkerEvent {
  request: Request
  respondWith(response: Promise<Response>): void
}

export function installSessionServiceWorker(
  scope: SessionServiceWorkerScope,
  { fetch: fetcher, now }: SessionServiceWorkerDependencies,
): void {
  const renewal = createSessionRenewal({
    fetch: fetcher,
    now,
    origin: scope.location.origin,
    async onRenewed(expiresAt, isCurrent) {
      const clients = await scope.clients.matchAll()
      if (!isCurrent()) {
        return
      }
      for (const client of clients) {
        client.postMessage({ type: 'token-renewed', expiresAt })
      }
    },
  })

  scope.addEventListener('install', () => {
    void scope.skipWaiting()
  })

  scope.addEventListener('activate', (unknownEvent) => {
    const event = unknownEvent as ExtendableWorkerEvent
    event.waitUntil(scope.clients.claim())
  })

  scope.addEventListener('message', (unknownEvent) => {
    const event = unknownEvent as MessageWorkerEvent
    if (typeof event.data !== 'object' || event.data === null) {
      return
    }
    const message = event.data as {
      type?: unknown
      token?: unknown
      csrfToken?: unknown
      expiresAt?: unknown
    }
    if (message.type === 'csrf' && typeof message.token === 'string') {
      renewal.rememberCsrfToken(message.token)
      return
    }
    if (message.type === 'adopt-expiry' && typeof message.expiresAt === 'string') {
      renewal.adoptExpiry(message.expiresAt)
      return
    }
    if (message.type === 'stop') {
      renewal.clearSession()
      return
    }
    if (message.type === 'refresh-now') {
      if (typeof message.csrfToken === 'string') {
        renewal.rememberCsrfToken(message.csrfToken)
      }
      const work = renewal.refresh().then((result) => {
        event.ports?.[0]?.postMessage(result)
      })
      event.waitUntil(work)
    }
  })

  scope.addEventListener('fetch', (unknownEvent) => {
    const event = unknownEvent as FetchWorkerEvent
    if (decideIntercept(event.request.url, scope.location.origin) !== 'intercept') {
      return
    }
    renewal.rememberCsrfToken(event.request.headers.get(CSRF_HEADER))
    event.respondWith(renewal.fetch(event.request))
  })
}
