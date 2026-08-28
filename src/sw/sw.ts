/// <reference lib="webworker" />
import {
  installSessionServiceWorker,
  type SessionServiceWorkerScope,
} from './worker'

declare const self: ServiceWorkerGlobalScope

installSessionServiceWorker(self as unknown as SessionServiceWorkerScope, {
  fetch: (input, init) => fetch(input, init),
  now: Date.now,
})
