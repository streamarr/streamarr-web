import type { RenewalResult } from './renewalProtocol'

const RENEWAL_LEEWAY_MS = 30_000
const RETRY_BACKOFF_MIN_MS = 30_000
const RETRY_BACKOFF_MAX_MS = 16 * 60_000

interface RenewalSchedulerDependencies {
  requestRenewal: () => Promise<RenewalResult>
}

export interface RenewalScheduler {
  adoptExpiry(expiresAt: string): void
  stop(): void
}

export function createRenewalScheduler({
  requestRenewal,
}: RenewalSchedulerDependencies): RenewalScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined
  let retryBackoffMs = RETRY_BACKOFF_MIN_MS
  let generation = 0

  const clearTimer = (): void => {
    clearTimeout(timer)
    timer = undefined
  }

  const stop = (): void => {
    generation += 1
    clearTimer()
  }

  const nextRetryDelay = (): number => {
    const delay = retryBackoffMs
    retryBackoffMs = Math.min(retryBackoffMs * 2, RETRY_BACKOFF_MAX_MS)
    return delay
  }

  const schedule = (scheduledGeneration: number, delayMs: number): void => {
    timer = setTimeout(() => void runRenewal(scheduledGeneration), delayMs)
  }

  const runRenewal = async (scheduledGeneration: number): Promise<void> => {
    timer = undefined
    const result = await requestRenewal().catch(
      (): RenewalResult => ({ kind: 'unavailable' }),
    )
    if (scheduledGeneration !== generation) {
      return
    }
    if (result.kind === 'renewed') {
      adoptExpiry(result.expiresAt)
      return
    }
    if (result.kind === 'unavailable') {
      schedule(scheduledGeneration, nextRetryDelay())
    }
  }

  const adoptExpiry = (expiresAt: string): void => {
    const expiresAtMs = new Date(expiresAt).getTime()
    if (Number.isNaN(expiresAtMs)) {
      return
    }
    generation += 1
    clearTimer()
    retryBackoffMs = RETRY_BACKOFF_MIN_MS
    schedule(generation, Math.max(0, expiresAtMs - Date.now() - RENEWAL_LEEWAY_MS))
  }

  return { adoptExpiry, stop }
}
