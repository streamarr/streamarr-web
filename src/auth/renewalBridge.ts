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

  // navigator.serviceWorker.ready never settles when no registration's scope matches the
  // page, so discovery carries its own deadline instead of trusting the promise.
  const awaitActiveServiceWorker = async (): Promise<ServiceWorkerEndpoint | null> => {
    let deadline: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<null>((resolve) => {
      deadline = setTimeout(() => resolve(null), discoveryTimeoutMs)
    })
    try {
      return (await Promise.race([serviceWorkers.ready, expired]))?.active ?? null
    } finally {
      clearTimeout(deadline)
    }
  }

  const serviceWorkerEndpoint = async (): Promise<ServiceWorkerEndpoint | null> => {
    if (serviceWorkers.controller) {
      return serviceWorkers.controller
    }
    try {
      return await awaitActiveServiceWorker()
    } catch {
      return null
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

  const awaitReply = (port1: BridgeMessagePort, port2: BridgeMessagePort) => {
    let settled = false
    let resolveResult!: (value: RenewalResult) => void
    const result = new Promise<RenewalResult>((resolve) => {
      resolveResult = resolve
    })
    const finish = (value: RenewalResult): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      port1.close?.()
      port2.close?.()
      resolveResult(value)
    }
    const timeout = setTimeout(() => finish({ kind: 'unavailable' }), replyTimeoutMs)
    port1.onmessage = ({ data }) =>
      finish(isRenewalResult(data) ? data : { kind: 'unavailable' })
    return { result, finish }
  }

  const refreshNow = async (): Promise<RenewalResult> => {
    const serviceWorker = await serviceWorkerEndpoint()
    if (!serviceWorker) {
      return { kind: 'unavailable' }
    }
    const { port1, port2 } = createReplyChannel()
    const reply = awaitReply(port1, port2)
    try {
      serviceWorker.postMessage({ type: 'refresh-now', csrfToken: readCsrfToken() }, [port2])
    } catch {
      reply.finish({ kind: 'unavailable' })
    }
    const renewalResult = await reply.result
    if (renewalResult.kind === 'renewed') {
      postToSharedWorker({ type: 'adopt-expiry', expiresAt: renewalResult.expiresAt })
    }
    return renewalResult
  }

  const onSharedWorkerMessage = ({ data }: { data: unknown }): void => {
    if (typeof data !== 'object' || data === null) {
      return
    }
    const message = data as { type?: unknown; requestId?: unknown }
    if (message.type !== 'refresh-due' || typeof message.requestId !== 'number') {
      return
    }
    void refreshNow().then((result) => {
      postToSharedWorker({ type: 'refresh-result', requestId: message.requestId, result })
    })
  }

  const attachSharedWorker = (port: RenewalPort): void => {
    port.onmessage = onSharedWorkerMessage
    try {
      port.start()
    } catch {
      // The service worker remains the reactive correctness fallback.
    }
    // The host forgets a port only when told.
    window.addEventListener('pagehide', () => postToSharedWorker({ type: 'disconnect' }))
  }

  const onServiceWorkerMessage = ({ data }: { data: unknown }): void => {
    if (typeof data !== 'object' || data === null) {
      return
    }
    const message = data as { type?: unknown; expiresAt?: unknown }
    if (message.type === 'token-renewed' && typeof message.expiresAt === 'string') {
      postToSharedWorker({ type: 'adopt-expiry', expiresAt: message.expiresAt })
    }
  }

  if (sharedPort) {
    attachSharedWorker(sharedPort)
  }
  serviceWorkers.addEventListener('message', onServiceWorkerMessage)

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
