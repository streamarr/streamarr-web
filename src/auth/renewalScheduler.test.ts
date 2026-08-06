import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenewalScheduler } from './renewalScheduler'

const NOW = Date.parse('2026-08-06T12:00:00Z')

describe('renewal scheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldRequestRenewalThirtySecondsBeforeTheAdoptedExpiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const requestRenewal = vi.fn(async () => ({ kind: 'rejected' as const }))
    const scheduler = createRenewalScheduler({ requestRenewal })

    scheduler.adoptExpiry(new Date(NOW + 90_000).toISOString())
    await vi.advanceTimersByTimeAsync(59_999)
    expect(requestRenewal).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(requestRenewal).toHaveBeenCalledTimes(1)
  })

  it('shouldRearmFromTheExpiryReturnedByEachSuccessfulRenewal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const nextExpiry = new Date(NOW + 210_000).toISOString()
    const requestRenewal = vi
      .fn<() => Promise<{ kind: 'renewed'; expiresAt: string } | { kind: 'rejected' }>>()
      .mockResolvedValueOnce({ kind: 'renewed', expiresAt: nextExpiry })
      .mockResolvedValue({ kind: 'rejected' })
    const scheduler = createRenewalScheduler({ requestRenewal })
    scheduler.adoptExpiry(new Date(NOW + 90_000).toISOString())

    await vi.advanceTimersByTimeAsync(60_000)
    expect(requestRenewal).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(119_999)
    expect(requestRenewal).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(requestRenewal).toHaveBeenCalledTimes(2)
  })

  it('shouldRetryTemporaryFailuresWithExponentialBackoff', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const requestRenewal = vi
      .fn<() => Promise<{ kind: 'unavailable' } | { kind: 'rejected' }>>()
      .mockResolvedValueOnce({ kind: 'unavailable' })
      .mockResolvedValueOnce({ kind: 'unavailable' })
      .mockResolvedValue({ kind: 'rejected' })
    const scheduler = createRenewalScheduler({ requestRenewal })
    scheduler.adoptExpiry(new Date(NOW + 30_000).toISOString())

    await vi.advanceTimersByTimeAsync(0)
    expect(requestRenewal).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(requestRenewal).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(requestRenewal).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(requestRenewal).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(requestRenewal).toHaveBeenCalledTimes(3)
  })

  it('shouldIgnoreAnInFlightRenewalResultAfterLogoutStopsTheScheduler', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    let release!: (result: { kind: 'renewed'; expiresAt: string }) => void
    const result = new Promise<{ kind: 'renewed'; expiresAt: string }>((resolve) => {
      release = resolve
    })
    const requestRenewal = vi.fn(() => result)
    const scheduler = createRenewalScheduler({ requestRenewal })
    scheduler.adoptExpiry(new Date(NOW + 30_000).toISOString())
    await vi.advanceTimersByTimeAsync(0)

    scheduler.stop()
    release({ kind: 'renewed', expiresAt: new Date(NOW + 90_000).toISOString() })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(requestRenewal).toHaveBeenCalledTimes(1)
  })

  it('shouldBackOffWhenTheRenewalAdapterThrows', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const requestRenewal = vi
      .fn<() => Promise<{ kind: 'rejected' }>>()
      .mockRejectedValueOnce(new TypeError('message channel closed'))
      .mockResolvedValue({ kind: 'rejected' })
    const scheduler = createRenewalScheduler({ requestRenewal })
    scheduler.adoptExpiry(new Date(NOW + 30_000).toISOString())

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(requestRenewal).toHaveBeenCalledTimes(2)
  })

  it('shouldIgnoreAnInvalidExpiryWithoutDisturbingTheClock', async () => {
    vi.useFakeTimers()
    const requestRenewal = vi.fn(async () => ({ kind: 'rejected' as const }))
    const scheduler = createRenewalScheduler({ requestRenewal })

    scheduler.adoptExpiry('not-an-instant')
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)

    expect(requestRenewal).not.toHaveBeenCalled()
  })

  it('shouldCapTemporaryFailureBackoffAtSixteenMinutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const requestRenewal = vi.fn(async () => ({ kind: 'unavailable' as const }))
    const scheduler = createRenewalScheduler({ requestRenewal })
    scheduler.adoptExpiry(new Date(NOW + 30_000).toISOString())

    for (const delay of [0, 30_000, 60_000, 120_000, 240_000, 480_000, 960_000]) {
      await vi.advanceTimersByTimeAsync(delay)
    }
    expect(requestRenewal).toHaveBeenCalledTimes(7)
    await vi.advanceTimersByTimeAsync(959_999)
    expect(requestRenewal).toHaveBeenCalledTimes(7)

    await vi.advanceTimersByTimeAsync(1)
    expect(requestRenewal).toHaveBeenCalledTimes(8)
  })
})
