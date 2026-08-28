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

  const adoptExpiry = (expiresAt: string): void => {
    const expiresAtMs = new Date(expiresAt).getTime()
    if (Number.isNaN(expiresAtMs)) {
      return
    }
    generation += 1
    const scheduledGeneration = generation
    clearTimer()
    retryBackoffMs = RETRY_BACKOFF_MIN_MS
    const runRenewal = async (): Promise<void> => {
      timer = undefined
      const result = await requestRenewal().catch(
        (): RenewalResult => ({ kind: 'unavailable' }),
      )
      if (scheduledGeneration !== generation) {
        return
      }
      if (result.kind === 'renewed') {
        adoptExpiry(result.expiresAt)
      } else if (result.kind === 'unavailable') {
        const delay = retryBackoffMs
        retryBackoffMs = Math.min(retryBackoffMs * 2, RETRY_BACKOFF_MAX_MS)
        timer = setTimeout(() => void runRenewal(), delay)
      }
    }
    timer = setTimeout(
      () => void runRenewal(),
      Math.max(0, expiresAtMs - Date.now() - RENEWAL_LEEWAY_MS),
    )
  }

  return { adoptExpiry, stop }
}
