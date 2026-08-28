/// <reference lib="webworker" />
import {
  createRenewalSharedWorkerHost,
  type RenewalPort,
} from './renewalSharedWorker'

declare const self: SharedWorkerGlobalScope

const host = createRenewalSharedWorkerHost()

self.addEventListener('connect', (event) => {
  for (const port of event.ports) {
    host.connect(port as unknown as RenewalPort)
  }
})
