import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { AuthApiError, request } from './http'

describe('http requests', () => {
  afterEach(() => {
    document.cookie = '__Host-XSRF-TOKEN=; Max-Age=0; Secure; Path=/'
  })

  it('shouldAttachCsrfHeaderToUnsafeRequestWithoutCallerOptIn', async () => {
    document.cookie = '__Host-XSRF-TOKEN=csrf-post; Secure; Path=/'
    let header: string | null = null
    server.use(
      http.post('/api/test/unsafe', ({ request: received }) => {
        header = received.headers.get('X-XSRF-TOKEN')
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await request('/api/test/unsafe', { method: 'POST' })

    expect(header).toBe('csrf-post')
  })

  it('shouldRetryUnsafeRequestOnceWhenServerRemintsCsrfCookie', async () => {
    document.cookie = '__Host-XSRF-TOKEN=stale-token; Secure; Path=/'
    const headers: (string | null)[] = []
    server.use(
      http.post('/api/test/recover', ({ request: received }) => {
        headers.push(received.headers.get('X-XSRF-TOKEN'))
        if (headers.length === 1) {
          document.cookie = '__Host-XSRF-TOKEN=fresh-token; Secure; Path=/'
          return HttpResponse.json(
            { code: 'CSRF_TOKEN_REQUIRED' },
            { status: 403 },
          )
        }
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await expect(
      request('/api/test/recover', { method: 'POST' }),
    ).resolves.toBeDefined()

    expect(headers).toEqual(['stale-token', 'fresh-token'])
  })

  it('shouldStopAfterOneRetryWhenCsrfRecoveryStillFails', async () => {
    document.cookie = '__Host-XSRF-TOKEN=csrf-token; Secure; Path=/'
    let attempts = 0
    server.use(
      http.post('/api/test/still-rejected', () => {
        attempts += 1
        return HttpResponse.json(
          { code: 'CSRF_TOKEN_REQUIRED' },
          { status: 403 },
        )
      }),
    )

    await expect(
      request('/api/test/still-rejected', { method: 'POST' }),
    ).rejects.toBeInstanceOf(AuthApiError)

    expect(attempts).toBe(2)
  })

  it('shouldNotRetryAnUnrelatedForbiddenResponse', async () => {
    let attempts = 0
    server.use(
      http.post('/api/test/forbidden', () => {
        attempts += 1
        return HttpResponse.json({ code: 'FORBIDDEN' }, { status: 403 })
      }),
    )

    await expect(
      request('/api/test/forbidden', { method: 'POST' }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })

    expect(attempts).toBe(1)
  })
})
