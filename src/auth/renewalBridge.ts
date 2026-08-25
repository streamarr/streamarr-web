import { isRenewalResult, type RenewalResult } from './renewalProtocol'
import type { RenewalPort } from './renewalSharedWorker'

export interface BridgeMessagePort {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: unknown): void
  close?(): void
}

interface ServiceWorkerEndpoint {
  postMessage(message: unknown, transfer?: BridgeMessagePort[]): void
}

export interface ServiceWorkerConnection {
  controller: ServiceWorkerEndpoint | null
  ready: Promise<{ active: ServiceWorkerEndpoint | null }>
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ): void
}

interface RenewalBridgeDependencies {
  sharedPort: RenewalPort | null
  serviceWorkers: ServiceWorkerConnection
  readCsrfToken: () => string | null
  replyTimeoutMs?: number
  discoveryTimeoutMs?: number
  createReplyChannel: () => {
    port1: BridgeMessagePort
    port2: BridgeMessagePort
  }
}

export interface RenewalBridge {
  adoptExpiry(expiresAt: string): void
  refreshNow(): Promise<RenewalResult>
  stop(): void
}

export const inactiveRenewalBridge: RenewalBridge = {
  adoptExpiry() {},
  async refreshNow() {
    return { kind: 'unavailable' }
  },
  stop() {},
}

export function createRenewalBridge({
  sharedPort,
  serviceWorkers,
  readCsrfToken,
  createReplyChannel,
  replyTimeoutMs = 30_000,
  discoveryTimeoutMs = 3_000,
}: RenewalBridgeDependencies): RenewalBridge {
  const postToSharedWorker = (message: unknown): void => {
    try {
      sharedPort?.postMessage(message)
    } catch {
      // Reactive service-worker renewal remains available if the shared worker exits.
    }
  }

  const serviceWorkerEndpoint = async (): Promise<ServiceWorkerEndpoint | null> => {
    // navigator.serviceWorker.ready never settles when no registration's scope matches the
    // page, so discovery carries its own deadline instead of trusting the promise.
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      if (serviceWorkers.controller) {
        return serviceWorkers.controller
      }
      const ready = await Promise.race([
        serviceWorkers.ready,
        new Promise<null>((resolve) => {
          deadline = setTimeout(() => resolve(null), discoveryTimeoutMs)
        }),
      ])
      return ready?.active ?? null
    } catch {
      return null
    } finally {
      clearTimeout(deadline)
    }
  }

  const postToServiceWorker = async (message: unknown): Promise<void> => {
    const serviceWorker = await serviceWorkerEndpoint()
    try {
      serviceWorker?.postMessage(message)
    } catch {
      // A replaced worker will be rediscovered on the next request.
    }
  }

  const refreshNow = async (): Promise<RenewalResult> => {
    const serviceWorker = await serviceWorkerEndpoint()
    if (!serviceWorker) {
      return { kind: 'unavailable' }
    }
    const { port1, port2 } = createReplyChannel()
    let finish!: (value: RenewalResult) => void
    const result = new Promise<RenewalResult>((resolve) => {
      let settled = false
      finish = (value: RenewalResult): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        port1.close?.()
        port2.close?.()
        resolve(value)
      }
      const timeout = setTimeout(
        () => finish({ kind: 'unavailable' }),
        replyTimeoutMs,
      )
      port1.onmessage = ({ data }) =>
        finish(isRenewalResult(data) ? data : { kind: 'unavailable' })
    })
    try {
      serviceWorker.postMessage(
        { type: 'refresh-now', csrfToken: readCsrfToken() },
        [port2],
      )
    } catch {
      finish({ kind: 'unavailable' })
    }
    const renewalResult = await result
    if (renewalResult.kind === 'renewed') {
      postToSharedWorker({
        type: 'adopt-expiry',
        expiresAt: renewalResult.expiresAt,
      })
    }
    return renewalResult
  }

  if (sharedPort) {
    sharedPort.onmessage = ({ data }) => {
      if (typeof data !== 'object' || data === null) {
        return
      }
      const message = data as { type?: unknown; requestId?: unknown }
      if (message.type !== 'refresh-due' || typeof message.requestId !== 'number') {
        return
      }
      void refreshNow().then((result) => {
        postToSharedWorker({
          type: 'refresh-result',
          requestId: message.requestId,
          result,
        })
      })
    }
    try {
      sharedPort.start()
    } catch {
      // The service worker remains the reactive correctness fallback.
    }
    // The host forgets a port only when told; a closed tab would otherwise keep receiving
    // refresh-due dispatches until postMessage finally throws.
    window.addEventListener('pagehide', () => postToSharedWorker({ type: 'disconnect' }))
  }

  serviceWorkers.addEventListener('message', ({ data }) => {
    if (typeof data !== 'object' || data === null) {
      return
    }
    const message = data as { type?: unknown; expiresAt?: unknown }
    if (message.type === 'token-renewed' && typeof message.expiresAt === 'string') {
      postToSharedWorker({ type: 'adopt-expiry', expiresAt: message.expiresAt })
    }
  })

  return {
    adoptExpiry(expiresAt) {
      postToSharedWorker({ type: 'adopt-expiry', expiresAt })
      void postToServiceWorker({ type: 'adopt-expiry', expiresAt })
    },
    refreshNow,
    stop() {
      postToSharedWorker({ type: 'stop' })
      void postToServiceWorker({ type: 'stop' })
    },
  }
}
