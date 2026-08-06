import { describe, expect, it, vi } from 'vitest'
import {
  installSessionServiceWorker,
  type SessionServiceWorkerScope,
} from './worker'

const NEXT_EXPIRY = '2026-08-06T12:10:00Z'

function fakeScope() {
  const listeners = new Map<string, (event: never) => void>()
  const scope: SessionServiceWorkerScope = {
    location: { origin: 'https://streamarr.test' },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => []),
    },
    skipWaiting: vi.fn(async () => {}),
    addEventListener(type, listener) {
      listeners.set(type, listener as (event: never) => void)
    },
  }
  return { scope, listeners }
}

describe('session service worker', () => {
  it('shouldActivateImmediatelyAndClaimExistingPages', async () => {
    const { scope, listeners } = fakeScope()
    installSessionServiceWorker(scope, { fetch, now: () => Date.now() })
    let activation: Promise<unknown> | undefined

    listeners.get('install')?.({} as never)
    listeners.get('activate')?.({
      waitUntil(promise: Promise<unknown>) {
        activation = promise
      },
    } as never)
    await activation

    expect(scope.skipWaiting).toHaveBeenCalledOnce()
    expect(scope.clients.claim).toHaveBeenCalledOnce()
  })

  it('shouldKeepMessageDrivenRefreshAliveAndReplyWithTheNextExpiry', async () => {
    let refreshRequest: Request | undefined
    const fetcher: typeof fetch = async (input, init) => {
      refreshRequest = new Request(input, init)
      return Response.json({ accessTokenExpiresAt: NEXT_EXPIRY, scope: 'profile' })
    }
    const { scope, listeners } = fakeScope()
    installSessionServiceWorker(scope, { fetch: fetcher, now: () => Date.parse('2026-08-06') })
    const reply = { postMessage: vi.fn() }
    let lifetime: Promise<unknown> | undefined

    listeners.get('message')?.({
      data: { type: 'refresh-now', csrfToken: 'csrf-from-page' },
      ports: [reply],
      waitUntil(promise: Promise<unknown>) {
        lifetime = promise
      },
    } as never)
    await lifetime

    expect(refreshRequest?.headers.get('X-XSRF-TOKEN')).toBe('csrf-from-page')
    expect(reply.postMessage).toHaveBeenCalledWith({
      kind: 'renewed',
      expiresAt: NEXT_EXPIRY,
    })
  })

  it('shouldBroadcastTheNextExpiryToEveryControlledPage', async () => {
    const firstClient = { postMessage: vi.fn() }
    const secondClient = { postMessage: vi.fn() }
    const { scope, listeners } = fakeScope()
    vi.mocked(scope.clients.matchAll).mockResolvedValue([firstClient, secondClient])
    installSessionServiceWorker(scope, {
      fetch: async () => Response.json({ accessTokenExpiresAt: NEXT_EXPIRY }),
      now: () => Date.parse('2026-08-06'),
    })
    let lifetime: Promise<unknown> | undefined

    listeners.get('message')?.({
      data: { type: 'refresh-now' },
      waitUntil(promise: Promise<unknown>) {
        lifetime = promise
      },
    } as never)
    await lifetime

    expect(firstClient.postMessage).toHaveBeenCalledWith({
      type: 'token-renewed',
      expiresAt: NEXT_EXPIRY,
    })
    expect(secondClient.postMessage).toHaveBeenCalledWith({
      type: 'token-renewed',
      expiresAt: NEXT_EXPIRY,
    })
  })

  it('shouldRememberTheCsrfTokenSentByAPageForLaterRenewal', async () => {
    let refreshRequest: Request | undefined
    const { scope, listeners } = fakeScope()
    installSessionServiceWorker(scope, {
      fetch: async (input, init) => {
        refreshRequest = new Request(input, init)
        return Response.json({ accessTokenExpiresAt: NEXT_EXPIRY })
      },
      now: () => Date.parse('2026-08-06'),
    })
    let lifetime: Promise<unknown> | undefined

    listeners.get('message')?.({ data: { type: 'csrf', token: 'remembered-token' } } as never)
    listeners.get('message')?.({
      data: { type: 'refresh-now' },
      waitUntil(promise: Promise<unknown>) {
        lifetime = promise
      },
    } as never)
    await lifetime

    expect(refreshRequest?.headers.get('X-XSRF-TOKEN')).toBe('remembered-token')
  })

  it('shouldUseAnAdoptedExpiryToPreflightAnInterceptedApiRequest', async () => {
    const paths: string[] = []
    const { scope, listeners } = fakeScope()
    installSessionServiceWorker(scope, {
      fetch: async (input) => {
        const path = new URL(input instanceof Request ? input.url : input).pathname
        paths.push(path)
        return path === '/api/auth/refresh'
          ? Response.json({ accessTokenExpiresAt: NEXT_EXPIRY })
          : Response.json({ data: { me: { id: 'user-1' } } })
      },
      now: () => Date.parse('2026-08-06T12:00:00Z'),
    })
    let response: Promise<Response> | undefined

    listeners.get('message')?.({
      data: { type: 'adopt-expiry', expiresAt: '2026-08-06T12:00:20Z' },
    } as never)
    listeners.get('fetch')?.({
      request: new Request('https://streamarr.test/graphql'),
      respondWith(value: Promise<Response>) {
        response = value
      },
    } as never)
    await response

    expect(paths).toEqual(['/api/auth/refresh', '/graphql'])
  })

  it('shouldClearTheAdoptedExpiryWhenThePageEndsTheSession', async () => {
    const paths: string[] = []
    const { scope, listeners } = fakeScope()
    installSessionServiceWorker(scope, {
      fetch: async (input) => {
        paths.push(new URL(input instanceof Request ? input.url : input).pathname)
        return Response.json({ data: { me: null } })
      },
      now: () => Date.parse('2026-08-06T12:00:00Z'),
    })
    let response: Promise<Response> | undefined

    listeners.get('message')?.({
      data: { type: 'adopt-expiry', expiresAt: '2026-08-06T12:00:20Z' },
    } as never)
    listeners.get('message')?.({ data: { type: 'stop' } } as never)
    listeners.get('fetch')?.({
      request: new Request('https://streamarr.test/graphql'),
      respondWith(value: Promise<Response>) {
        response = value
      },
    } as never)
    await response

    expect(paths).toEqual(['/graphql'])
  })

  it('shouldLeaveAssetRequestsToTheBrowsersNormalFetchPipeline', () => {
    const fetcher = vi.fn<typeof fetch>()
    const { scope, listeners } = fakeScope()
    installSessionServiceWorker(scope, { fetch: fetcher, now: () => Date.now() })
    const respondWith = vi.fn()

    listeners.get('fetch')?.({
      request: new Request('https://streamarr.test/assets/app.js'),
      respondWith,
    } as never)

    expect(respondWith).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shouldIgnoreMalformedPageMessages', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ accessTokenExpiresAt: NEXT_EXPIRY }),
    )
    const { scope, listeners } = fakeScope()
    installSessionServiceWorker(scope, {
      fetch: fetcher,
      now: () => Date.parse('2026-08-06'),
    })

    for (const data of [null, 'csrf', { type: 'csrf', token: 1 }, { type: 'adopt-expiry', expiresAt: 1 }, { type: 'unknown' }]) {
      listeners.get('message')?.({ data } as never)
    }

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shouldNotBroadcastARefreshThatFinishesAfterTheSessionEnds', async () => {
    let releaseClients!: (clients: Array<{ postMessage(message: unknown): void }>) => void
    const clients = new Promise<Array<{ postMessage(message: unknown): void }>>((resolve) => {
      releaseClients = resolve
    })
    const page = { postMessage: vi.fn() }
    const reply = { postMessage: vi.fn() }
    const { scope, listeners } = fakeScope()
    vi.mocked(scope.clients.matchAll).mockReturnValue(clients)
    installSessionServiceWorker(scope, {
      fetch: async () => Response.json({ accessTokenExpiresAt: NEXT_EXPIRY }),
      now: () => Date.parse('2026-08-06'),
    })
    let lifetime: Promise<unknown> | undefined

    listeners.get('message')?.({
      data: { type: 'refresh-now' },
      ports: [reply],
      waitUntil(promise: Promise<unknown>) {
        lifetime = promise
      },
    } as never)
    await Promise.resolve()
    listeners.get('message')?.({ data: { type: 'stop' } } as never)
    releaseClients([page])
    await lifetime

    expect(page.postMessage).not.toHaveBeenCalled()
    expect(reply.postMessage).toHaveBeenCalledWith({ kind: 'rejected' })
  })
})
