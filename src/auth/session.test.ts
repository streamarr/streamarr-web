import { HttpResponse, graphql, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createApolloClient } from '../graphql/client'
import { server } from '../test/server'
import { createSessionStore, probeSession } from './session'
import { meFixture } from '../test/meFixture'

const ME = meFixture({ scope: 'account' })

describe('session store', () => {
  it('shouldProbeOnceAndShareTheAnswerAcrossConcurrentCallers', async () => {
    const probe = vi.fn().mockResolvedValue('authenticated' as const)
    const store = createSessionStore(probe)

    const answers = await Promise.all([store.ensure(), store.ensure()])

    expect(answers).toEqual(['authenticated', 'authenticated'])
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('shouldExposeTheCachedAnswerWithoutProbing', async () => {
    const probe = vi.fn().mockResolvedValue('authenticated' as const)
    const store = createSessionStore(probe)

    expect(store.peek()).toBeNull()
    await store.ensure()

    expect(store.peek()).toBe('authenticated')
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('shouldNotProbeAgainOnceTheAnswerIsKnown', async () => {
    const probe = vi.fn().mockResolvedValue('anonymous' as const)
    const store = createSessionStore(probe)

    await store.ensure()
    await store.ensure()

    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('shouldRetryTheProbeAfterAnIndeterminateAnswer', async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error('server unreachable'))
      .mockResolvedValue('authenticated' as const)
    const store = createSessionStore(probe)

    await expect(store.ensure()).rejects.toThrow('server unreachable')
    await expect(store.ensure()).resolves.toBe('authenticated')
  })

  it('shouldTrustASignInOverAStaleProbeAnswer', async () => {
    const probe = vi.fn().mockResolvedValue('anonymous' as const)
    const store = createSessionStore(probe)
    await store.ensure()

    store.markAuthenticated()

    await expect(store.ensure()).resolves.toBe('authenticated')
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('shouldTrustASignOutWithoutProbing', async () => {
    const store = createSessionStore(vi.fn())

    store.markAnonymous()

    await expect(store.ensure()).resolves.toBe('anonymous')
  })
})

describe('probeSession', () => {
  it('shouldAnswerAuthenticatedWhenTheServerAnswersMe', async () => {
    server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))

    await expect(probeSession(createApolloClient(vi.fn()))).resolves.toBe('authenticated')
  })

  it('shouldAnswerAnonymousWhenTheServerRejectsTheSession', async () => {
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )

    await expect(probeSession(createApolloClient(vi.fn()))).resolves.toBe('anonymous')
  })

  it('shouldAnswerAnonymousWhenTheAccessTokenExpiredUnrenewed', async () => {
    server.use(
      http.post('/graphql', () => HttpResponse.json({ code: 'EXPIRED_TOKEN' }, { status: 401 })),
    )

    await expect(probeSession(createApolloClient(vi.fn()))).resolves.toBe('anonymous')
  })

  it('shouldAnswerAuthenticatedWhenOnlyAProfileChoiceIsMissing', async () => {
    // PROFILE_REQUIRED means the server recognized the session and wants a scope upgrade — that
    // is a signed-in visitor, and /select is the error link's routing to arrange, not the guard's.
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          errors: [{ message: 'profile required', extensions: { code: 'PROFILE_REQUIRED' } }],
        }),
      ),
    )

    await expect(probeSession(createApolloClient(vi.fn()))).resolves.toBe('authenticated')
  })

  it('shouldThrowWhenTheServerCannotAnswer', async () => {
    server.use(http.post('/graphql', () => HttpResponse.json({}, { status: 500 })))

    await expect(probeSession(createApolloClient(vi.fn()))).rejects.toThrow()
  })

  it('shouldNotTriggerTheAuthRedirectWhileProbing', async () => {
    // The guard owns arrival gating; if the probe's 401 also fired the error link's redirect the
    // two would race for the router.
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const onAuthRoute = vi.fn()

    await probeSession(createApolloClient(onAuthRoute))

    expect(onAuthRoute).not.toHaveBeenCalled()
  })
})
