import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../test/server'
import {
  AuthApiError,
  getSetupStatus,
  login,
  logout,
  selectProfile,
  setup,
} from './api'

const TOKENS = {
  accessTokenExpiresAt: '2026-07-08T12:10:00Z',
  scope: 'profile',
}

describe('auth api', () => {
  afterEach(() => {
    document.cookie = '__Host-XSRF-TOKEN=; Max-Age=0; Secure; Path=/'
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; Path=/'
  })

  it('shouldReportSetupStatus', async () => {
    server.use(
      http.get('/api/auth/status', () =>
        HttpResponse.json({ setupComplete: true }),
      ),
    )
    await expect(getSetupStatus()).resolves.toEqual({ setupComplete: true })
  })

  it('shouldReturnTokensAndRequestCookieModeOnLogin', async () => {
    let sentBody: unknown
    server.use(
      http.post('/api/auth/login', async ({ request }) => {
        sentBody = await request.json()
        return HttpResponse.json(TOKENS)
      }),
    )

    const result = await login({
      email: 'a@b.com',
      password: 'pw',
      deviceName: 'web',
    })

    expect(result).toEqual(TOKENS)
    expect(sentBody).toMatchObject({
      email: 'a@b.com',
      password: 'pw',
      cookieMode: true,
    })
  })

  it('shouldThrowTypedErrorWithCodeOnRejectedLogin', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 }),
      ),
    )

    await expect(
      login({ email: 'a@b.com', password: 'wrong' }),
    ).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    })
    await expect(
      login({ email: 'a@b.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(AuthApiError)
  })

  it('shouldAttachCsrfHeaderOnLogin', async () => {
    document.cookie = '__Host-XSRF-TOKEN=csrf-login; Secure; Path=/'
    let header: string | null = null
    server.use(
      http.post('/api/auth/login', ({ request }) => {
        header = request.headers.get('X-XSRF-TOKEN')
        return HttpResponse.json(TOKENS)
      }),
    )

    await login({ email: 'a@b.com', password: 'pw' })

    expect(header).toBe('csrf-login')
  })

  it('shouldAttachCsrfHeaderOnSetup', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-setup'
    let header: string | null = null
    server.use(
      http.post('/api/auth/setup', ({ request }) => {
        header = request.headers.get('X-XSRF-TOKEN')
        return HttpResponse.json(TOKENS, { status: 201 })
      }),
    )

    await setup({
      email: 'admin@example.com',
      displayName: 'Admin',
      password: 'pw',
      householdName: 'Home',
      profileName: 'Owner',
    })

    expect(header).toBe('csrf-setup')
  })

  it('shouldAttachCsrfHeaderOnAuthenticatedSelect', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-abc'
    let header: string | null = null
    server.use(
      http.post('/api/auth/select-profile', ({ request }) => {
        header = request.headers.get('X-XSRF-TOKEN')
        return HttpResponse.json(TOKENS)
      }),
    )

    await selectProfile('11111111-1111-1111-1111-111111111111')

    expect(header).toBe('csrf-abc')
  })

  it('shouldAttachCsrfHeaderAndResolveLogoutWithoutBody', async () => {
    document.cookie = '__Host-XSRF-TOKEN=csrf-logout; Secure; Path=/'
    let header: string | null = null
    let body: string | null = null
    server.use(
      http.post('/api/auth/refresh/revoke', async ({ request }) => {
        header = request.headers.get('X-XSRF-TOKEN')
        body = await request.text()
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await expect(logout()).resolves.toBeUndefined()
    expect(header).toBe('csrf-logout')
    expect(body).toBe('')
  })
})
