import { describe, expect, it, vi } from 'vitest'
import {
  decideIntercept,
  isRecoverableAccessTokenResponse,
  rememberCsrfToken,
  SingleFlight,
} from './decisions'

const ORIGIN = 'https://streamarr.example'

describe('decideIntercept', () => {
  it('shouldInterceptGraphqlFetch', () => {
    expect(decideIntercept(`${ORIGIN}/graphql`, ORIGIN)).toBe('intercept')
  })

  it('shouldInterceptApiFetches', () => {
    expect(decideIntercept(`${ORIGIN}/api/auth/select-profile`, ORIGIN)).toBe(
      'intercept',
    )
    expect(decideIntercept(`${ORIGIN}/api/images/123`, ORIGIN)).toBe(
      'intercept',
    )
  })

  it('shouldPassThroughStreamAndRefreshFetches', () => {
    // The refresh call is the worker's own; intercepting it would recurse.
    expect(decideIntercept(`${ORIGIN}/api/auth/refresh`, ORIGIN)).toBe(
      'pass-through',
    )
    // Playback URLs carry their own token; hls.js requests must not be touched.
    expect(
      decideIntercept(`${ORIGIN}/api/stream/abc/multivariant.m3u8`, ORIGIN),
    ).toBe('pass-through')
    expect(
      decideIntercept(`${ORIGIN}/api/stream/abc/segment-0001.m4s?t=x`, ORIGIN),
    ).toBe('pass-through')
  })

  it('shouldPassThroughCrossOriginAndAppShellFetches', () => {
    expect(decideIntercept('https://other.example/graphql', ORIGIN)).toBe(
      'pass-through',
    )
    expect(decideIntercept(`${ORIGIN}/assets/app.js`, ORIGIN)).toBe(
      'pass-through',
    )
    expect(decideIntercept(`${ORIGIN}/`, ORIGIN)).toBe('pass-through')
  })
})

describe('isRecoverableAccessTokenResponse', () => {
  it('shouldDetectExpiredTokenResponse', () => {
    expect(isRecoverableAccessTokenResponse(401, { code: 'EXPIRED_TOKEN' })).toBe(true)
  })

  it('shouldIgnoreOtherUnauthorizedAndNonJsonResponses', () => {
    // INVALID_TOKEN / AUTHENTICATION_REQUIRED must fall through to the page's login routing.
    expect(isRecoverableAccessTokenResponse(401, { code: 'INVALID_TOKEN' })).toBe(false)
    expect(isRecoverableAccessTokenResponse(401, null)).toBe(false)
    expect(isRecoverableAccessTokenResponse(401, 'nope')).toBe(false)
    expect(isRecoverableAccessTokenResponse(403, { code: 'EXPIRED_TOKEN' })).toBe(false)
    expect(isRecoverableAccessTokenResponse(200, { code: 'EXPIRED_TOKEN' })).toBe(false)
  })
})

describe('rememberCsrfToken', () => {
  it('shouldLearnTokenFromInterceptedPageRequestAfterWorkerRestart', () => {
    expect(rememberCsrfToken(null, 'csrf-from-page')).toBe('csrf-from-page')
  })

  it('shouldKeepCachedTokenWhenRequestDoesNotCarryOne', () => {
    expect(rememberCsrfToken('cached-token', null)).toBe('cached-token')
    expect(rememberCsrfToken('cached-token', '   ')).toBe('cached-token')
  })
})

describe('SingleFlight', () => {
  it('shouldQueueAndReplayWhileSingleRefreshInFlight', async () => {
    // One SW instance serves every tab, so a module-scoped in-flight promise IS the
    // cross-tab lock: concurrent callers share exactly one refresh.
    const flight = new SingleFlight<boolean>()
    let release = () => {}
    const refresh = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true)
        }),
    )

    const results = Promise.all([
      flight.run(refresh),
      flight.run(refresh),
      flight.run(refresh),
    ])
    release()

    expect(await results).toEqual([true, true, true])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shouldRunAgainAfterPreviousFlightSettles', async () => {
    const flight = new SingleFlight<number>()
    const operation = vi.fn(async () => 42)

    await flight.run(operation)
    await flight.run(operation)

    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('shouldPropagateFailureToAllWaitersAndClear', async () => {
    const flight = new SingleFlight<boolean>()
    const failing = vi.fn(async () => {
      throw new Error('refresh failed')
    })

    const first = flight.run(failing)
    const second = flight.run(failing)
    await expect(first).rejects.toThrow('refresh failed')
    await expect(second).rejects.toThrow('refresh failed')

    const recovered = vi.fn(async () => true)
    expect(await flight.run(recovered)).toBe(true)
    expect(failing).toHaveBeenCalledTimes(1)
    expect(recovered).toHaveBeenCalledTimes(1)
  })
})
