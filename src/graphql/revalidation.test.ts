import { describe, expect, it, vi } from 'vitest'
import { deferred } from '../test/deferred'
import { installRevalidation } from './revalidation'

function fakeDocument(visibilityState: DocumentVisibilityState = 'visible') {
  const target = new EventTarget()
  const document = Object.assign(target, { visibilityState })
  return {
    document,
    becomeHidden() {
      document.visibilityState = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    },
    becomeVisible() {
      document.visibilityState = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

function setup({ visibilityState }: { visibilityState?: DocumentVisibilityState } = {}) {
  const window = new EventTarget()
  const page = fakeDocument(visibilityState)
  const subscribedListeners = new Set<() => void>()
  let pending = deferred()
  const refetchActive = vi.fn(() => pending.promise)
  const uninstall = installRevalidation({
    refetchActive,
    onSubscribed: (listener) => {
      subscribedListeners.add(listener)
      return () => subscribedListeners.delete(listener)
    },
    window,
    document: page.document,
  })
  return {
    ...page,
    refetchActive,
    uninstall,
    recover: () => subscribedListeners.forEach((listener) => listener()),
    goOnline: () => window.dispatchEvent(new Event('online')),
    finishRefetch() {
      pending.resolve()
      pending = deferred()
    },
    listeningForRecovery: () => subscribedListeners.size > 0,
  }
}

// Lets every promise continuation that is already queued run.
async function settled() {
  vi.useFakeTimers()
  try {
    await vi.advanceTimersByTimeAsync(0)
  } finally {
    vi.useRealTimers()
  }
}

describe('revalidation', () => {
  it('shouldRefetchOnceWhenRecoveryOnlineAndAReturnOverlap', () => {
    const page = setup()

    page.recover()
    page.goOnline()
    page.becomeHidden()
    page.becomeVisible()

    expect(page.refetchActive).toHaveBeenCalledOnce()
  })

  it('shouldRefetchOnceMoreWhenASocketSubscribesDuringAnEarlierRefetch', async () => {
    const page = setup()
    page.goOnline()

    page.recover()
    page.recover()
    page.becomeHidden()
    page.becomeVisible()
    expect(page.refetchActive).toHaveBeenCalledOnce()
    page.finishRefetch()

    await vi.waitFor(() => expect(page.refetchActive).toHaveBeenCalledTimes(2))
    page.finishRefetch()
    await settled()
    expect(page.refetchActive).toHaveBeenCalledTimes(2)
  })

  it('shouldRefetchAgainAfterTheEarlierRefetchSettles', async () => {
    const page = setup()
    page.goOnline()

    page.finishRefetch()

    await vi.waitFor(() => {
      page.recover()
      expect(page.refetchActive).toHaveBeenCalledTimes(2)
    })
  })

  it('shouldRefetchWhenThePageReturnsFromTheBackground', () => {
    const page = setup({ visibilityState: 'hidden' })

    page.becomeVisible()

    expect(page.refetchActive).toHaveBeenCalledOnce()
  })

  it('shouldIgnoreVisibilityEventsThatAreNotAReturn', () => {
    const page = setup()

    page.becomeVisible()
    page.becomeHidden()

    expect(page.refetchActive).not.toHaveBeenCalled()
  })

  it('shouldStaySilentAndRecoverWhenARefetchFails', async () => {
    const window = new EventTarget()
    const refetchActive = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    installRevalidation({
      refetchActive,
      onSubscribed: () => () => {},
      window,
      document: fakeDocument().document,
    })

    window.dispatchEvent(new Event('online'))

    await vi.waitFor(() => {
      window.dispatchEvent(new Event('online'))
      expect(refetchActive).toHaveBeenCalledTimes(2)
    })
  })

  it('shouldStopListeningWhenUninstalled', () => {
    const page = setup({ visibilityState: 'hidden' })

    page.uninstall()
    page.goOnline()
    page.becomeVisible()

    expect(page.refetchActive).not.toHaveBeenCalled()
    expect(page.listeningForRecovery()).toBe(false)
  })
})
