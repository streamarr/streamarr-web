import { readCsrfCookie } from './csrf'
import {
  createRenewalBridge,
  type BridgeMessagePort,
  type RenewalBridge,
  type ServiceWorkerConnection,
} from './renewalBridge'
import type { RenewalPort } from './renewalSharedWorker'

export function createBrowserRenewalBridge(): RenewalBridge {
  const workerUrl = import.meta.env.DEV
    ? '/src/auth/renewal-worker.ts'
    : '/renewal-worker.js'
  let sharedPort: RenewalPort | null = null
  if ('SharedWorker' in globalThis) {
    try {
      sharedPort = new SharedWorker(workerUrl, {
        name: 'streamarr-session-renewal',
        type: 'module',
      }).port as unknown as RenewalPort
    } catch {
      // Reactive service-worker renewal remains the correctness fallback.
    }
  }

  return createRenewalBridge({
    sharedPort,
    serviceWorkers: navigator.serviceWorker as unknown as ServiceWorkerConnection,
    readCsrfToken: readCsrfCookie,
    createReplyChannel: () => {
      const channel = new MessageChannel()
      return channel as unknown as {
        port1: BridgeMessagePort
        port2: BridgeMessagePort
      }
    },
  })
}
