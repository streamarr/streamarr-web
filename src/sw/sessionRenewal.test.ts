import { describe, expect, it, vi } from 'vitest'
import { createSessionRenewal } from './sessionRenewal'

const NOW = Date.parse('2026-08-06T12:00:00Z')
const NEXT_EXPIRY = '2026-08-06T12:10:00Z'

describe('session renewal', () => {
  it('shouldPublishTheNextExpiryAfterCookieSessionRenewal', async () => {
    let refreshRequest: Request | undefined
    const fetcher: typeof fetch = async (input, init) => {
      refreshRequest = new Request(input, init)
      return Response.json({ accessTokenExpiresAt: NEXT_EXPIRY, scope: 'profile' })
    }
    const onRenewed = vi.fn()
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed })
    renewal.rememberCsrfToken('csrf-token')

    await expect(renewal.refresh()).resolves.toEqual({
      kind: 'renewed',
      expiresAt: NEXT_EXPIRY,
    })
    expect(refreshRequest).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    })
    expect(refreshRequest?.url).toBe('https://streamarr.test/api/auth/refresh')
    expect(refreshRequest?.headers.get('X-XSRF-TOKEN')).toBe('csrf-token')
    expect(onRenewed).toHaveBeenCalledWith(NEXT_EXPIRY, expect.any(Function))
  })

  it('shouldKeepASuccessfulRenewalWhenExpiryNotificationFails', async () => {
    const renewal = createSessionRenewal({
      fetch: async () => Response.json({ accessTokenExpiresAt: NEXT_EXPIRY }),
      now: () => NOW,
      onRenewed: async () => {
        throw new TypeError('client disappeared')
      },
    })

    await expect(renewal.refresh()).resolves.toEqual({
      kind: 'renewed',
      expiresAt: NEXT_EXPIRY,
    })
  })

  it('shouldReportARejectedRefreshSessionAsTerminal', async () => {
    const renewal = createSessionRenewal({
      fetch: async () => Response.json({ code: 'INVALID_REFRESH_TOKEN' }, { status: 401 }),
      now: () => NOW,
      onRenewed: vi.fn(),
    })

    await expect(renewal.refresh()).resolves.toEqual({ kind: 'rejected' })
  })

  it('shouldReportARefreshServiceErrorAsTemporarilyUnavailable', async () => {
    const renewal = createSessionRenewal({
      fetch: async () => Response.json({ code: 'INTERNAL_ERROR' }, { status: 500 }),
      now: () => NOW,
      onRenewed: vi.fn(),
    })

    await expect(renewal.refresh()).resolves.toEqual({ kind: 'unavailable' })
  })

  it.each([
    ['missing expiry', { scope: 'profile' }],
    ['malformed expiry', { accessTokenExpiresAt: 'not-an-instant' }],
    ['non-future expiry', { accessTokenExpiresAt: new Date(NOW).toISOString() }],
  ])('shouldRejectA200RefreshResponseWithA%s', async (_case, body) => {
    const renewal = createSessionRenewal({
      fetch: async () => Response.json(body),
      now: () => NOW,
      onRenewed: vi.fn(),
    })

    await expect(renewal.refresh()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('shouldReportANetworkFailureAsTemporarilyUnavailable', async () => {
    const renewal = createSessionRenewal({
      fetch: async () => {
        throw new TypeError('network offline')
      },
      now: () => NOW,
      onRenewed: vi.fn(),
    })

    await expect(renewal.refresh()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('shouldShareOneRefreshAcrossConcurrentCallers', async () => {
    let release!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      release = resolve
    })
    const fetcher = vi.fn<typeof fetch>(() => response)
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })

    const first = renewal.refresh()
    const second = renewal.refresh()
    release(Response.json({ accessTokenExpiresAt: NEXT_EXPIRY, scope: 'profile' }))

    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'renewed', expiresAt: NEXT_EXPIRY },
      { kind: 'renewed', expiresAt: NEXT_EXPIRY },
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('shouldIgnoreAnInFlightRefreshResultAfterTheSessionEnds', async () => {
    let release!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      release = resolve
    })
    const fetcher = vi.fn<typeof fetch>(() => response)
    const onRenewed = vi.fn()
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed })
    const result = renewal.refresh()

    renewal.clearSession()
    release(Response.json({ accessTokenExpiresAt: NEXT_EXPIRY }))

    await expect(result).resolves.toEqual({ kind: 'rejected' })
    expect(onRenewed).not.toHaveBeenCalled()
    await expect(renewal.refresh()).resolves.toEqual({ kind: 'rejected' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('shouldRenewAndReplayAnExpiredApiRequestOnce', async () => {
    const requests: Request[] = []
    let apiAttempts = 0
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      if (new URL(request.url).pathname === '/api/auth/refresh') {
        return Response.json({ accessTokenExpiresAt: NEXT_EXPIRY, scope: 'profile' })
      }
      apiAttempts += 1
      if (apiAttempts === 1) {
        return Response.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })
      }
      return Response.json({ title: 'Arrival' })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })
    const request = new Request('https://streamarr.test/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: '{ media { title } }' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await renewal.fetch(request)

    await expect(response.json()).resolves.toEqual({ title: 'Arrival' })
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/graphql',
      '/api/auth/refresh',
      '/graphql',
    ])
    await expect(requests[2].json()).resolves.toEqual({
      query: '{ media { title } }',
    })
  })

  it('shouldExposeATemporaryRefreshOutageWithoutReportingLogout', async () => {
    const fetcher: typeof fetch = async (input) => {
      if (new URL(input instanceof Request ? input.url : input).pathname === '/api/auth/refresh') {
        throw new TypeError('network offline')
      }
      return Response.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })

    const response = await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'SESSION_REFRESH_UNAVAILABLE',
      message: 'Your session could not be renewed. Try again.',
    })
  })

  it('shouldPassThroughANonJsonUnauthorizedResponseWithoutRefreshing', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response('unauthorized', { status: 401 }),
    )
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })

    const response = await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(response.status).toBe(401)
    expect(await response.text()).toBe('unauthorized')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('shouldReportSessionEndedWhenTheRefreshSessionIsRejected', async () => {
    // A raw EXPIRED_TOKEN passthrough wedges the app: the error router deliberately ignores
    // that code (the worker owns it), so a terminally rejected renewal must surface as the
    // code that routes to sign-in.
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      return path === '/api/auth/refresh'
        ? Response.json({ code: 'INVALID_REFRESH_TOKEN' }, { status: 401 })
        : Response.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })

    const response = await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Your session has ended. Sign in again.',
    })
  })

  it('shouldKeepReportingSessionEndedWithoutRetryingAfterARejectedRenewal', async () => {
    const paths: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      paths.push(path)
      return path === '/api/auth/refresh'
        ? Response.json({ code: 'INVALID_REFRESH_TOKEN' }, { status: 401 })
        : Response.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })

    await renewal.fetch(new Request('https://streamarr.test/graphql'))
    const second = await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(second.status).toBe(401)
    await expect(second.json()).resolves.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
    expect(paths).toEqual(['/graphql', '/api/auth/refresh', '/graphql'])
  })

  it('shouldRenewBeforeSendingARequestWhoseKnownTokenIsNearExpiry', async () => {
    const paths: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      paths.push(path)
      return path === '/api/auth/refresh'
        ? Response.json({ accessTokenExpiresAt: NEXT_EXPIRY, scope: 'profile' })
        : Response.json({ data: { me: { id: 'user-1' } } })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })
    renewal.adoptExpiry(new Date(NOW + 20_000).toISOString())

    const response = await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(response.status).toBe(200)
    expect(paths).toEqual(['/api/auth/refresh', '/graphql'])
  })

  it('shouldForgetTheAdoptedExpiryWhenTheSessionEnds', async () => {
    const paths: string[] = []
    const fetcher: typeof fetch = async (input) => {
      paths.push(new URL(input instanceof Request ? input.url : input).pathname)
      return Response.json({ data: { me: null } })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })
    renewal.adoptExpiry(new Date(NOW + 20_000).toISOString())

    renewal.clearSession()
    await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(paths).toEqual(['/graphql'])
  })

  it('shouldReportAPreflightRefreshOutageWhenTheRequestAlsoFindsAnExpiredToken', async () => {
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      return path === '/api/auth/refresh'
        ? Response.json({ code: 'INTERNAL_ERROR' }, { status: 500 })
        : Response.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })
    renewal.adoptExpiry(new Date(NOW + 20_000).toISOString())

    const response = await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('shouldReportSessionEndedWhenAPreflightRefreshIsRejected', async () => {
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      return path === '/api/auth/refresh'
        ? Response.json({ code: 'INVALID_REFRESH_TOKEN' }, { status: 401 })
        : Response.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })
    renewal.adoptExpiry(new Date(NOW + 20_000).toISOString())

    const response = await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' })
  })

  it('shouldStopPreflightRenewalAfterTheRefreshSessionIsRejected', async () => {
    const paths: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      paths.push(path)
      return path === '/api/auth/refresh'
        ? Response.json({ code: 'INVALID_REFRESH_TOKEN' }, { status: 401 })
        : Response.json({ data: { me: { id: 'user-1' } } })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })
    renewal.adoptExpiry(new Date(NOW + 20_000).toISOString())

    await renewal.fetch(new Request('https://streamarr.test/graphql'))
    await renewal.fetch(new Request('https://streamarr.test/graphql'))
    await expect(renewal.refresh()).resolves.toEqual({ kind: 'rejected' })

    expect(paths).toEqual(['/api/auth/refresh', '/graphql', '/graphql'])
  })

  it('shouldPreserveAnExpiredResponseAfterASuccessfulPreflightAlreadyRenewedOnce', async () => {
    const paths: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      paths.push(path)
      return path === '/api/auth/refresh'
        ? Response.json({ accessTokenExpiresAt: NEXT_EXPIRY })
        : Response.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })
    renewal.adoptExpiry(new Date(NOW + 20_000).toISOString())

    const response = await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(response.status).toBe(401)
    expect(paths).toEqual(['/api/auth/refresh', '/graphql'])
  })

  it('shouldNotPreflightARequestWhenTheKnownTokenHasTimeRemaining', async () => {
    const paths: string[] = []
    const fetcher: typeof fetch = async (input) => {
      paths.push(new URL(input instanceof Request ? input.url : input).pathname)
      return Response.json({ data: { me: { id: 'user-1' } } })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })
    renewal.adoptExpiry(new Date(NOW + 31_000).toISOString())

    await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(paths).toEqual(['/graphql'])
  })

  it('shouldIgnoreAnInvalidAdoptedExpiry', async () => {
    const paths: string[] = []
    const fetcher: typeof fetch = async (input) => {
      paths.push(new URL(input instanceof Request ? input.url : input).pathname)
      return Response.json({ data: { me: { id: 'user-1' } } })
    }
    const renewal = createSessionRenewal({ fetch: fetcher, now: () => NOW, onRenewed: vi.fn() })

    renewal.adoptExpiry('not-an-instant')
    await renewal.fetch(new Request('https://streamarr.test/graphql'))

    expect(paths).toEqual(['/graphql'])
  })
})
