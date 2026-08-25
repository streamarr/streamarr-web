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

interface PageMessage {
  type?: unknown
  expiresAt?: unknown
  requestId?: unknown
  result?: unknown
}

export function createRenewalSharedWorkerHost({
  requestTimeoutMs = 30_000,
}: { requestTimeoutMs?: number } = {}): RenewalSharedWorkerHost {
  const ports = new Set<RenewalPort>()
  const pending = new Map<number, PendingRenewal>()
  let nextRequestId = 1

  const postTo = (port: RenewalPort, message: unknown): boolean => {
    try {
      port.postMessage(message)
      return true
    } catch {
      ports.delete(port)
      return false
    }
  }

  const broadcast = (message: unknown): boolean => {
    let delivered = false
    for (const port of ports) {
      delivered = postTo(port, message) || delivered
    }
    return delivered
  }

  const settle = (requestId: number, result: RenewalResult): void => {
    const waiting = pending.get(requestId)
    if (!waiting) {
      return
    }
    clearTimeout(waiting.timeout)
    pending.delete(requestId)
    waiting.resolve(result)
  }

  const requestRenewal = (): Promise<RenewalResult> => {
    if (ports.size === 0) {
      return Promise.resolve({ kind: 'unavailable' })
    }
    const requestId = nextRequestId++
    return new Promise((resolve) => {
      const timeout = setTimeout(
        () => settle(requestId, { kind: 'unavailable' }),
        requestTimeoutMs,
      )
      pending.set(requestId, { resolve, timeout })
      if (!broadcast({ type: 'refresh-due', requestId })) {
        settle(requestId, { kind: 'unavailable' })
      }
    })
  }

  const scheduler = createRenewalScheduler({ requestRenewal })

  const handleMessage = (port: RenewalPort, data: unknown): void => {
    if (typeof data !== 'object' || data === null) {
      return
    }
    const message = data as PageMessage
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
      settle(
        message.requestId,
        isRenewalResult(message.result) ? message.result : { kind: 'unavailable' },
      )
    }
  }

  return {
    connect(port) {
      ports.add(port)
      port.onmessage = ({ data }) => handleMessage(port, data)
      try {
        port.start()
      } catch {
        ports.delete(port)
      }
    },
  }
}
