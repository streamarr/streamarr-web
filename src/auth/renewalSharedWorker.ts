import { isRenewalResult, type RenewalResult } from './renewalProtocol'
import { createRenewalScheduler } from './renewalScheduler'

export interface RenewalPort {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: unknown): void
  start(): void
}

export interface RenewalSharedWorkerHost {
  connect(port: RenewalPort): void
}

interface PendingRenewal {
  resolve: (result: RenewalResult) => void
  timeout: ReturnType<typeof setTimeout>
}

export function createRenewalSharedWorkerHost({
  requestTimeoutMs = 30_000,
}: { requestTimeoutMs?: number } = {}): RenewalSharedWorkerHost {
  const ports = new Set<RenewalPort>()
  const pending = new Map<number, PendingRenewal>()
  let nextRequestId = 1

  const requestRenewal = (): Promise<RenewalResult> => {
    if (ports.size === 0) {
      return Promise.resolve({ kind: 'unavailable' })
    }
    const requestId = nextRequestId++
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId)
        resolve({ kind: 'unavailable' })
      }, requestTimeoutMs)
      pending.set(requestId, { resolve, timeout })
      let delivered = false
      for (const port of ports) {
        try {
          port.postMessage({ type: 'refresh-due', requestId })
          delivered = true
        } catch {
          ports.delete(port)
        }
      }
      if (!delivered) {
        clearTimeout(timeout)
        pending.delete(requestId)
        resolve({ kind: 'unavailable' })
      }
    })
  }

  const scheduler = createRenewalScheduler({ requestRenewal })

  return {
    connect(port) {
      ports.add(port)
      port.onmessage = ({ data }) => {
        if (typeof data !== 'object' || data === null) {
          return
        }
        const message = data as {
          type?: unknown
          expiresAt?: unknown
          requestId?: unknown
          result?: unknown
        }
        if (message.type === 'adopt-expiry' && typeof message.expiresAt === 'string') {
          scheduler.adoptExpiry(message.expiresAt)
          return
        }
        if (message.type === 'stop') {
          scheduler.stop()
          return
        }
        if (message.type === 'disconnect') {
          ports.delete(port)
          return
        }
        if (message.type === 'refresh-result' && typeof message.requestId === 'number') {
          const waiting = pending.get(message.requestId)
          if (!waiting) {
            return
          }
          clearTimeout(waiting.timeout)
          pending.delete(message.requestId)
          waiting.resolve(
            isRenewalResult(message.result)
              ? message.result
              : { kind: 'unavailable' },
          )
        }
      }
      try {
        port.start()
      } catch {
        ports.delete(port)
      }
    },
  }
}
