import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRenewalSharedWorkerHost,
  type RenewalPort,
} from './renewalSharedWorker'

const NOW = Date.parse('2026-08-06T12:00:00Z')

class FakePort implements RenewalPort {
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

describe('renewal shared worker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldAskConnectedPagesToPerformOneDueRenewal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const host = createRenewalSharedWorkerHost()
    const firstPage = new FakePort()
    const secondPage = new FakePort()
    host.connect(firstPage)
    host.connect(secondPage)

    firstPage.receive({
      type: 'adopt-expiry',
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(firstPage.posted).toEqual([{ type: 'refresh-due', requestId: 1 }])
    expect(secondPage.posted).toEqual([{ type: 'refresh-due', requestId: 1 }])
  })

  it('shouldContinueDispatchingWhenOneConnectedPageHasClosed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const host = createRenewalSharedWorkerHost()
    const closedPage = new FakePort()
    closedPage.postMessage = () => {
      throw new DOMException('port closed', 'InvalidStateError')
    }
    const openPage = new FakePort()
    host.connect(closedPage)
    host.connect(openPage)

    openPage.receive({
      type: 'adopt-expiry',
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(openPage.posted).toEqual([{ type: 'refresh-due', requestId: 1 }])
  })

  it('shouldIgnoreAPagePortThatCannotStart', () => {
    const host = createRenewalSharedWorkerHost()
    const page = new FakePort()
    page.start = () => {
      throw new DOMException('port closed', 'InvalidStateError')
    }

    expect(() => host.connect(page)).not.toThrow()
  })

  it('shouldBackOffWithoutWaitingForTimeoutWhenEveryPageHasClosed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const host = createRenewalSharedWorkerHost()
    const page = new FakePort()
    page.postMessage = vi.fn(() => {
      throw new DOMException('port closed', 'InvalidStateError')
    })
    host.connect(page)
    page.receive({
      type: 'adopt-expiry',
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(page.postMessage).toHaveBeenCalledOnce()
  })

  it('shouldRetryWhenAPageReturnsAMalformedRenewalResult', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const host = createRenewalSharedWorkerHost()
    const page = new FakePort()
    host.connect(page)
    page.receive({
      type: 'adopt-expiry',
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })
    await vi.advanceTimersByTimeAsync(0)

    page.receive({ type: 'refresh-result', requestId: 1, result: { kind: 'surprise' } })
    await vi.advanceTimersByTimeAsync(30_000)

    expect(page.posted).toEqual([
      { type: 'refresh-due', requestId: 1 },
      { type: 'refresh-due', requestId: 2 },
    ])
  })

  it('shouldRearmFromTheExpiryReturnedByAConnectedPage', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const host = createRenewalSharedWorkerHost()
    const page = new FakePort()
    host.connect(page)
    page.receive({
      type: 'adopt-expiry',
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })
    await vi.advanceTimersByTimeAsync(0)

    page.receive({
      type: 'refresh-result',
      requestId: 1,
      result: { kind: 'renewed', expiresAt: new Date(NOW + 90_000).toISOString() },
    })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(page.posted).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)

    expect(page.posted).toEqual([
      { type: 'refresh-due', requestId: 1 },
      { type: 'refresh-due', requestId: 2 },
    ])
  })

  it('shouldRetryWhenNoPageAnswersBeforeTheRequestTimeout', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const host = createRenewalSharedWorkerHost({ requestTimeoutMs: 100 })
    const page = new FakePort()
    host.connect(page)
    page.receive({
      type: 'adopt-expiry',
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(page.posted).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)

    expect(page.posted).toEqual([
      { type: 'refresh-due', requestId: 1 },
      { type: 'refresh-due', requestId: 2 },
    ])
  })

  it('shouldCancelTheClockWhenAPageEndsTheSession', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const host = createRenewalSharedWorkerHost()
    const page = new FakePort()
    host.connect(page)
    page.receive({
      type: 'adopt-expiry',
      expiresAt: new Date(NOW + 90_000).toISOString(),
    })

    page.receive({ type: 'stop' })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(page.posted).toEqual([])
  })

  it('shouldNotDispatchRenewalWorkToAPageAfterItDisconnects', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const host = createRenewalSharedWorkerHost()
    const page = new FakePort()
    host.connect(page)
    page.receive({
      type: 'adopt-expiry',
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })

    page.receive({ type: 'disconnect' })
    await vi.advanceTimersByTimeAsync(0)

    expect(page.posted).toEqual([])
  })

  it('shouldIgnoreAStaleDuplicatePageResponse', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const host = createRenewalSharedWorkerHost()
    const page = new FakePort()
    host.connect(page)
    page.receive({
      type: 'adopt-expiry',
      expiresAt: new Date(NOW + 30_000).toISOString(),
    })
    await vi.advanceTimersByTimeAsync(0)

    page.receive({ type: 'refresh-result', requestId: 1, result: { kind: 'rejected' } })
    page.receive({
      type: 'refresh-result',
      requestId: 1,
      result: { kind: 'renewed', expiresAt: new Date(NOW + 90_000).toISOString() },
    })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(page.posted).toEqual([{ type: 'refresh-due', requestId: 1 }])
  })

  it('shouldIgnoreMalformedAndUnknownPageMessages', async () => {
    vi.useFakeTimers()
    const host = createRenewalSharedWorkerHost()
    const page = new FakePort()
    host.connect(page)

    for (const data of [null, 'stop', { type: 'adopt-expiry', expiresAt: 1 }, { type: 'refresh-result', requestId: '1' }, { type: 'unknown' }]) {
      page.receive(data)
    }
    await vi.runAllTimersAsync()

    expect(page.posted).toEqual([])
  })
})
