import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRenewalBridge,
  inactiveRenewalBridge,
  type BridgeMessagePort,
  type ServiceWorkerConnection,
} from './renewalBridge'
import type { RenewalPort } from './renewalSharedWorker'

class FakeSharedPort implements RenewalPort {
  readonly posted: unknown[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  start(): void {}

  receive(data: unknown): void {
    this.onmessage?.({ data })
  }
}

function replyChannel() {
  const port1: BridgeMessagePort = { onmessage: null, postMessage: vi.fn() }
  const port2: BridgeMessagePort = {
    onmessage: null,
    postMessage(message) {
      port1.onmessage?.({ data: message })
    },
  }
  return { port1, port2 }
}

describe('renewal bridge', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldExposeAnInertFallbackWhenBrowserWorkersAreUnavailable', async () => {
    inactiveRenewalBridge.adoptExpiry('2026-08-06T12:10:00Z')
    inactiveRenewalBridge.stop()

    await expect(inactiveRenewalBridge.refreshNow()).resolves.toEqual({
      kind: 'unavailable',
    })
  })

  it('shouldExecuteASharedWorkerTickThroughTheServiceWorker', async () => {
    const sharedPort = new FakeSharedPort()
    const serviceWorker = {
      postMessage: vi.fn((message: unknown, transfer: BridgeMessagePort[]) => {
        expect(message).toEqual({ type: 'refresh-now', csrfToken: 'current-csrf' })
        transfer[0].postMessage({
          kind: 'renewed',
          expiresAt: '2026-08-06T12:10:00Z',
        })
      }),
    }
    const serviceWorkers: ServiceWorkerConnection = {
      controller: serviceWorker,
      ready: Promise.resolve({ active: serviceWorker }),
      addEventListener: vi.fn(),
    }
    createRenewalBridge({
      sharedPort,
      serviceWorkers,
      readCsrfToken: () => 'current-csrf',
      createReplyChannel: replyChannel,
    })

    sharedPort.receive({ type: 'refresh-due', requestId: 7 })
    await vi.waitFor(() => {
      expect(sharedPort.posted).toContainEqual({
        type: 'refresh-result',
        requestId: 7,
        result: { kind: 'renewed', expiresAt: '2026-08-06T12:10:00Z' },
      })
    })
  })

  it('shouldTeachBothWorkersAboutEachCredentialExpiry', async () => {
    const sharedPort = new FakeSharedPort()
    const serviceWorker = { postMessage: vi.fn() }
    const serviceWorkers: ServiceWorkerConnection = {
      controller: serviceWorker,
      ready: Promise.resolve({ active: serviceWorker }),
      addEventListener: vi.fn(),
    }
    const bridge = createRenewalBridge({
      sharedPort,
      serviceWorkers,
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    bridge.adoptExpiry('2026-08-06T12:10:00Z')
    await vi.waitFor(() => {
      expect(serviceWorker.postMessage).toHaveBeenCalledWith({
        type: 'adopt-expiry',
        expiresAt: '2026-08-06T12:10:00Z',
      })
    })
    expect(sharedPort.posted).toContainEqual({
      type: 'adopt-expiry',
      expiresAt: '2026-08-06T12:10:00Z',
    })
  })

  it('shouldRearmTheSharedClockAfterReactiveServiceWorkerRenewal', () => {
    const sharedPort = new FakeSharedPort()
    let onServiceWorkerMessage: ((event: { data: unknown }) => void) | undefined
    const serviceWorkers: ServiceWorkerConnection = {
      controller: null,
      ready: Promise.resolve({ active: null }),
      addEventListener(_type, listener) {
        onServiceWorkerMessage = listener
      },
    }
    createRenewalBridge({
      sharedPort,
      serviceWorkers,
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    onServiceWorkerMessage?.({
      data: { type: 'token-renewed', expiresAt: '2026-08-06T12:10:00Z' },
    })

    expect(sharedPort.posted).toContainEqual({
      type: 'adopt-expiry',
      expiresAt: '2026-08-06T12:10:00Z',
    })
  })

  it('shouldAdoptTheExpiryReturnedByColdStartRenewal', async () => {
    const sharedPort = new FakeSharedPort()
    const serviceWorker = {
      postMessage(_message: unknown, transfer: BridgeMessagePort[]) {
        transfer[0].postMessage({
          kind: 'renewed',
          expiresAt: '2026-08-06T12:10:00Z',
        })
      },
    }
    const bridge = createRenewalBridge({
      sharedPort,
      serviceWorkers: {
        controller: serviceWorker,
        ready: Promise.resolve({ active: serviceWorker }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    await bridge.refreshNow()

    expect(sharedPort.posted).toContainEqual({
      type: 'adopt-expiry',
      expiresAt: '2026-08-06T12:10:00Z',
    })
  })

  it('shouldKeepASuccessfulRefreshWhenTheSharedWorkerHasStopped', async () => {
    const sharedPort = new FakeSharedPort()
    sharedPort.postMessage = () => {
      throw new DOMException('worker stopped', 'InvalidStateError')
    }
    const serviceWorker = {
      postMessage(_message: unknown, transfer: BridgeMessagePort[]) {
        transfer[0].postMessage({
          kind: 'renewed',
          expiresAt: '2026-08-06T12:10:00Z',
        })
      },
    }
    const bridge = createRenewalBridge({
      sharedPort,
      serviceWorkers: {
        controller: serviceWorker,
        ready: Promise.resolve({ active: serviceWorker }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    await expect(bridge.refreshNow()).resolves.toEqual({
      kind: 'renewed',
      expiresAt: '2026-08-06T12:10:00Z',
    })
  })

  it('shouldKeepReactiveRenewalWhenTheSharedWorkerCannotStart', async () => {
    const sharedPort = new FakeSharedPort()
    sharedPort.start = () => {
      throw new DOMException('worker stopped', 'InvalidStateError')
    }
    const serviceWorker = {
      postMessage(_message: unknown, transfer: BridgeMessagePort[]) {
        transfer[0].postMessage({ kind: 'rejected' })
      },
    }

    const bridge = createRenewalBridge({
      sharedPort,
      serviceWorkers: {
        controller: serviceWorker,
        ready: Promise.resolve({ active: serviceWorker }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    await expect(bridge.refreshNow()).resolves.toEqual({ kind: 'rejected' })
  })

  it('shouldTreatAMalformedServiceWorkerReplyAsTemporarilyUnavailable', async () => {
    const serviceWorker = {
      postMessage(_message: unknown, transfer: BridgeMessagePort[]) {
        transfer[0].postMessage(null)
      },
    }
    const bridge = createRenewalBridge({
      sharedPort: null,
      serviceWorkers: {
        controller: serviceWorker,
        ready: Promise.resolve({ active: serviceWorker }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    await expect(bridge.refreshNow()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('shouldTreatAMissingServiceWorkerReplyAsTemporarilyUnavailable', async () => {
    vi.useFakeTimers()
    const serviceWorker = { postMessage: vi.fn() }
    const bridge = createRenewalBridge({
      sharedPort: null,
      serviceWorkers: {
        controller: serviceWorker,
        ready: Promise.resolve({ active: serviceWorker }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
      replyTimeoutMs: 100,
    })

    const renewal = bridge.refreshNow()
    await vi.advanceTimersByTimeAsync(100)
    const outcome = await Promise.race([renewal, Promise.resolve('still-pending')])

    expect(outcome).toEqual({ kind: 'unavailable' })
  })

  it('shouldReportUnavailableWhenNoServiceWorkerControlsThePage', async () => {
    const bridge = createRenewalBridge({
      sharedPort: null,
      serviceWorkers: {
        controller: null,
        ready: Promise.resolve({ active: null }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    await expect(bridge.refreshNow()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('shouldReportUnavailableWhenNoServiceWorkerEverTakesControl', async () => {
    // navigator.serviceWorker.ready never settles when no registration's scope matches the
    // page (the dev scope regression), so endpoint discovery must carry its own deadline.
    vi.useFakeTimers()
    const bridge = createRenewalBridge({
      sharedPort: null,
      serviceWorkers: {
        controller: null,
        ready: new Promise(() => {}),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
      discoveryTimeoutMs: 100,
    })

    const renewal = bridge.refreshNow()
    await vi.advanceTimersByTimeAsync(100)

    await expect(renewal).resolves.toEqual({ kind: 'unavailable' })
  })

  it('shouldReportUnavailableWhenServiceWorkerReadinessFails', async () => {
    const bridge = createRenewalBridge({
      sharedPort: null,
      serviceWorkers: {
        controller: null,
        ready: Promise.reject(new TypeError('registration failed')),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    await expect(bridge.refreshNow()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('shouldReportUnavailableWhenTheServiceWorkerVanishesDuringDispatch', async () => {
    const serviceWorker = {
      postMessage() {
        throw new DOMException('worker stopped', 'InvalidStateError')
      },
    }
    const bridge = createRenewalBridge({
      sharedPort: null,
      serviceWorkers: {
        controller: serviceWorker,
        ready: Promise.resolve({ active: serviceWorker }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    await expect(bridge.refreshNow()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('shouldUseTheActiveServiceWorkerWhileTheControllerIsBeingEstablished', async () => {
    const active = {
      postMessage(_message: unknown, transfer: BridgeMessagePort[]) {
        transfer[0].postMessage({ kind: 'rejected' })
      },
    }
    const bridge = createRenewalBridge({
      sharedPort: null,
      serviceWorkers: {
        controller: null,
        ready: Promise.resolve({ active }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    await expect(bridge.refreshNow()).resolves.toEqual({ kind: 'rejected' })
  })

  it('shouldStopBothWorkerLayersWhenTheSessionEnds', async () => {
    const sharedPort = new FakeSharedPort()
    const serviceWorker = { postMessage: vi.fn() }
    const bridge = createRenewalBridge({
      sharedPort,
      serviceWorkers: {
        controller: serviceWorker,
        ready: Promise.resolve({ active: serviceWorker }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    bridge.stop()

    expect(sharedPort.posted).toContainEqual({ type: 'stop' })
    await vi.waitFor(() => {
      expect(serviceWorker.postMessage).toHaveBeenCalledWith({ type: 'stop' })
    })
  })

  it('shouldDisconnectFromTheSharedClockWhenThePageGoesAway', () => {
    // The host only forgets a port when told; a silently closed tab would otherwise keep
    // receiving refresh-due dispatches until postMessage finally throws.
    const sharedPort = new FakeSharedPort()
    createRenewalBridge({
      sharedPort,
      serviceWorkers: {
        controller: null,
        ready: Promise.resolve({ active: null }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    window.dispatchEvent(new Event('pagehide'))

    expect(sharedPort.posted).toContainEqual({ type: 'disconnect' })
  })

  it('shouldKeepPageActionsSafeWhenTheServiceWorkerStops', async () => {
    const serviceWorker = {
      postMessage: vi.fn(() => {
        throw new DOMException('worker stopped', 'InvalidStateError')
      }),
    }
    const bridge = createRenewalBridge({
      sharedPort: null,
      serviceWorkers: {
        controller: serviceWorker,
        ready: Promise.resolve({ active: serviceWorker }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    bridge.adoptExpiry('2026-08-06T12:10:00Z')
    bridge.stop()
    await vi.waitFor(() => expect(serviceWorker.postMessage).toHaveBeenCalledTimes(2))
  })

  it('shouldIgnoreMalformedAndUnknownWorkerMessages', () => {
    const sharedPort = new FakeSharedPort()
    let onServiceWorkerMessage: ((event: { data: unknown }) => void) | undefined
    createRenewalBridge({
      sharedPort,
      serviceWorkers: {
        controller: null,
        ready: Promise.resolve({ active: null }),
        addEventListener(_type, listener) {
          onServiceWorkerMessage = listener
        },
      },
      readCsrfToken: () => null,
      createReplyChannel: replyChannel,
    })

    for (const data of [null, 'refresh-due', { type: 'refresh-due', requestId: '7' }, { type: 'unknown' }]) {
      sharedPort.receive(data)
    }
    for (const data of [null, 'token-renewed', { type: 'token-renewed', expiresAt: 7 }, { type: 'unknown' }]) {
      onServiceWorkerMessage?.({ data })
    }

    expect(sharedPort.posted).toEqual([])
  })

  it('shouldCloseTheReplyChannelAndIgnoreALateWorkerReply', async () => {
    vi.useFakeTimers()
    const closeFirst = vi.fn()
    const closeSecond = vi.fn()
    let transferred: BridgeMessagePort | undefined
    const port1: BridgeMessagePort = { onmessage: null, postMessage: vi.fn(), close: closeFirst }
    const port2: BridgeMessagePort = {
      onmessage: null,
      postMessage(message) {
        port1.onmessage?.({ data: message })
      },
      close: closeSecond,
    }
    const bridge = createRenewalBridge({
      sharedPort: null,
      serviceWorkers: {
        controller: {
          postMessage(_message, transfer) {
            transferred = transfer?.[0]
          },
        },
        ready: Promise.resolve({ active: null }),
        addEventListener: vi.fn(),
      },
      readCsrfToken: () => null,
      createReplyChannel: () => ({ port1, port2 }),
      replyTimeoutMs: 100,
    })

    const result = bridge.refreshNow()
    await vi.advanceTimersByTimeAsync(100)
    await expect(result).resolves.toEqual({ kind: 'unavailable' })
    transferred?.postMessage({ kind: 'renewed', expiresAt: '2026-08-06T12:10:00Z' })

    expect(closeFirst).toHaveBeenCalledOnce()
    expect(closeSecond).toHaveBeenCalledOnce()
  })
})
