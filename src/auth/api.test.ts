import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { AuthApiError, getSetupStatus, login, logout, selectProfile } from './api'

const TOKENS = { accessTokenExpiresAt: '2026-07-08T12:10:00Z', scope: 'profile' }

describe('auth api', () => {
  it('shouldReportSetupStatus', async () => {
    server.use(
      http.get('/api/auth/status', () => HttpResponse.json({ setupComplete: true })),
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

    const result = await login({ email: 'a@b.com', password: 'pw', deviceName: 'web' })

    expect(result).toEqual(TOKENS)
    expect(sentBody).toMatchObject({ email: 'a@b.com', password: 'pw', cookieMode: true })
  })

  it('shouldThrowTypedErrorWithCodeOnRejectedLogin', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 }),
      ),
    )

    await expect(login({ email: 'a@b.com', password: 'wrong' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    })
    await expect(login({ email: 'a@b.com', password: 'wrong' })).rejects.toBeInstanceOf(
      AuthApiError,
    )
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

  it('shouldResolveLogoutWithoutBody', async () => {
    server.use(http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })))
    await expect(logout()).resolves.toBeUndefined()
  })
})
