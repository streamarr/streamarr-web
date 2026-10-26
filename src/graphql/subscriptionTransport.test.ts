import { gql } from '@apollo/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenewalResult } from '../auth/renewalProtocol'
import { createApolloClient } from './client'
import { createSubscriptionTransport } from './subscriptionTransport'
import {
  connectAndSubscribe,
  FakeWebSocket,
  latestSocket,
  settle,
  type Frame,
} from '../test/fakeWebSocket'

const URL = 'wss://streamarr.test/graphql'
const STATUS_CHANGED = gql`
  subscription LibraryStatusChanged {
    libraryStatusChanged {
      id
      status
    }
  }
`

const LIBRARY_ADDED = gql`
  subscription LibraryAdded {
    libraryAdded {
      id
    }
  }
`

function setup({
  renewal = vi.fn<() => Promise<RenewalResult>>(async () => ({
    kind: 'renewed',
    expiresAt: '2026-10-15T12:00:00Z',
  })),
  random = (): number => 1,
} = {}) {
  const onSignedOut = vi.fn()
  const transport = createSubscriptionTransport({
    url: URL,
    renewal: { refreshNow: renewal },
    onSignedOut,
    webSocketImpl: FakeWebSocket,
    random,
  })
  const client = createApolloClient(vi.fn(), transport.link)
  // Each report keeps how many subscribe frames the newest socket had sent by then.
  const framesAtEachReport: number[] = []
  transport.onMissedChanges(() => {
    framesAtEachReport.push(latestSocket().subscriptionIds().length)
  })
  const results: { data?: unknown; error?: unknown }[] = []
  const completed = vi.fn()
  const subscribe = () =>
    client.subscribe({ query: STATUS_CHANGED }).subscribe({
      next: (result) => results.push(result),
      complete: completed,
    })
  // A second operation keeps the socket open while the first one ends.
  const subscribeToAdditions = () => client.subscribe({ query: LIBRARY_ADDED }).subscribe({})
  return {
    client,
    transport,
    renewal,
    onSignedOut,
    framesAtEachReport,
    results,
    completed,
    subscribe,
    subscribeToAdditions,
  }
}

function statusFrame(id: string, status: string): Frame {
  return {
    type: 'next',
    id,
    payload: { data: { libraryStatusChanged: { __typename: 'Library', id: 'movies', status } } },
  }
}

function errorCodes(code: string) {
  return [{ message: code, extensions: { code } }]
}

describe('subscription transport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldOpenNoSocketUntilAnOperationSubscribes', async () => {
    const { subscribe } = setup()
    await settle()
    expect(FakeWebSocket.instances).toHaveLength(0)

    const socket = await connectAndSubscribe(subscribe)

    expect(socket.url).toBe(URL)
    expect(socket.protocol).toBe('graphql-transport-ws')
    expect(socket.sent[0]).toEqual({ type: 'connection_init' })
    expect(socket.subscriptionIds()).toHaveLength(1)
  })

  it('shouldDeliverEachChangeToTheOperation', async () => {
    const { subscribe, results } = setup()
    const socket = await connectAndSubscribe(subscribe)

    socket.deliver(statusFrame(socket.subscriptionIds()[0], 'SCANNING'))
    await settle()

    expect(results).toEqual([
      {
        data: { libraryStatusChanged: { __typename: 'Library', id: 'movies', status: 'SCANNING' } },
      },
    ])
  })

  it.each(['resetStore', 'clearStore'] as const)(
    'shouldKeepDeliveringChangesAfterTheClientCalls %s',
    async (reset) => {
      const { client, subscribe, results, completed } = setup()
      const socket = await connectAndSubscribe(subscribe)

      await client[reset]()
      socket.deliver(statusFrame(socket.subscriptionIds()[0], 'SCANNING'))
      await settle()

      expect(results).toEqual([
        {
          data: {
            libraryStatusChanged: { __typename: 'Library', id: 'movies', status: 'SCANNING' },
          },
        },
      ])
      expect(completed).not.toHaveBeenCalled()
    },
  )

  it('shouldRenewThenReconnectAndSubscribeAgainWhenTheAccessTokenExpires', async () => {
    const order: string[] = []
    const renewal = vi.fn(async (): Promise<RenewalResult> => {
      order.push(`renew after ${FakeWebSocket.instances.length} sockets`)
      return { kind: 'renewed', expiresAt: '2026-10-15T12:00:00Z' }
    })
    const { subscribe, results } = setup({ renewal })
    const first = await connectAndSubscribe(subscribe)

    first.serverClose(4100, 'Access token expired')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(order).toEqual(['renew after 1 sockets'])
    const second = latestSocket()
    expect(second).not.toBe(first)
    second.accept()
    await settle()
    expect(second.subscriptionIds()).toHaveLength(1)
    second.deliver(statusFrame(second.subscriptionIds()[0], 'HEALTHY'))
    await settle()
    expect(results).toHaveLength(1)
  })

  it('shouldRenewBeforeReconnectingWhenTheHandshakeIsRefused', async () => {
    const { subscribe, renewal } = setup()
    subscribe()
    await settle()

    latestSocket().refuseHandshake()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(renewal).toHaveBeenCalledOnce()
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it.each([
    { code: 1001, reason: 'Going away' },
    { code: 4101, reason: 'Client fell behind' },
  ])('shouldReconnectWithoutRenewalAfterClose$code', async ({ code, reason }) => {
    const { subscribe, renewal } = setup()
    const first = await connectAndSubscribe(subscribe)

    first.serverClose(code, reason)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(renewal).not.toHaveBeenCalled()
  })

  it('shouldReconnectWithoutRenewalWhenTheNetworkDropsAnAcknowledgedSocket', async () => {
    const { subscribe, renewal } = setup()
    const first = await connectAndSubscribe(subscribe)

    first.drop()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(renewal).not.toHaveBeenCalled()
  })

  it.each([4400, 4401, 4409, 4429])(
    'shouldStopWithoutReconnectingWhenTheServerReportsClientDefect%i',
    async (code) => {
      const { subscribe, results, completed } = setup()
      const socket = await connectAndSubscribe(subscribe)

      socket.serverClose(code, 'client defect')
      await vi.advanceTimersByTimeAsync(120_000)

      expect(FakeWebSocket.instances).toHaveLength(1)
      expect(results).toHaveLength(1)
      expect(results[0].error).toBeInstanceOf(Error)
      expect(completed).toHaveBeenCalledOnce()
    },
  )

  it('shouldReconnectAndSubscribeEveryOperationAgainAfterAnUnexpectedServerFailure', async () => {
    const { subscribe, subscribeToAdditions, results, framesAtEachReport } = setup()
    subscribeToAdditions()
    const first = await connectAndSubscribe(subscribe)

    first.serverClose(1011, 'Internal error')
    await vi.advanceTimersByTimeAsync(1_000)

    const second = latestSocket()
    expect(second).not.toBe(first)
    expect(FakeWebSocket.instances).toHaveLength(2)
    second.accept()
    await settle()
    expect(second.subscriptionIds()).toHaveLength(2)
    expect(results).toEqual([])
    expect(framesAtEachReport).toEqual([2, 2])
  })

  it('shouldKeepRetryingPastFiveAttemptsWithDelaysCappedAtThirtySeconds', async () => {
    const renewal = vi.fn(async (): Promise<RenewalResult> => ({ kind: 'unavailable' }))
    const { subscribe } = setup({ renewal })
    subscribe()
    await settle()

    for (let attempt = 0; attempt < 8; attempt++) {
      latestSocket().refuseHandshake()
      await vi.advanceTimersByTimeAsync(30_000)
    }
    expect(FakeWebSocket.instances).toHaveLength(9)

    latestSocket().refuseHandshake()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(FakeWebSocket.instances).toHaveLength(9)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(10)
  })

  it('shouldSpreadRetriesBetweenHalfAndAllOfTheCeiling', async () => {
    const { subscribe } = setup({ random: () => 0 })
    const first = await connectAndSubscribe(subscribe)

    first.serverClose(1001)
    await vi.advanceTimersByTimeAsync(499)
    expect(FakeWebSocket.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('shouldSignOutAndStopReconnectingWhenRenewalIsRejected', async () => {
    const renewal = vi.fn(async (): Promise<RenewalResult> => ({ kind: 'rejected' }))
    const { subscribe, onSignedOut, completed } = setup({ renewal })
    const socket = await connectAndSubscribe(subscribe)

    socket.serverClose(4100, 'Access token expired')
    await vi.advanceTimersByTimeAsync(120_000)

    expect(onSignedOut).toHaveBeenCalledOnce()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(completed).toHaveBeenCalledOnce()
  })

  it('shouldCloseTheSocketAndEndEveryOperationWhenStopped', async () => {
    const { subscribe, transport, results, completed } = setup()
    const socket = await connectAndSubscribe(subscribe)
    const id = socket.subscriptionIds()[0]

    transport.stop()
    await settle()
    socket.deliver(statusFrame(id, 'SCANNING'))
    await vi.advanceTimersByTimeAsync(120_000)

    expect(socket.closedWith?.code).toBe(1000)
    expect(completed).toHaveBeenCalledOnce()
    expect(results).toEqual([])
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('shouldEndAWaitingReconnectWhenStopped', async () => {
    const { subscribe, transport, renewal } = setup()
    const socket = await connectAndSubscribe(subscribe)

    socket.serverClose(4100, 'Access token expired')
    await vi.advanceTimersByTimeAsync(100)
    transport.stop()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(renewal).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('shouldOpenANewSocketForTheNextSignInAfterStopping', async () => {
    const { subscribe, transport } = setup()
    await connectAndSubscribe(subscribe)
    transport.stop()

    const next = await connectAndSubscribe(subscribe)

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(next.subscriptionIds()).toHaveLength(1)
  })

  it('shouldMoveLiveOperationsToANewSocketAndDropLateFramesWhenTheIdentityChanges', async () => {
    const { subscribe, transport, results, framesAtEachReport } = setup()
    const earlier = await connectAndSubscribe(subscribe)
    const earlierId = earlier.subscriptionIds()[0]

    transport.replaceSocket()
    await settle()
    earlier.deliver(statusFrame(earlierId, 'SCANNING'))
    const next = latestSocket()
    next.accept()
    await settle()
    next.deliver(statusFrame(next.subscriptionIds()[0], 'REFRESHING'))
    await settle()

    expect(earlier.closedWith?.code).toBe(1000)
    expect(next).not.toBe(earlier)
    expect(results).toEqual([
      {
        data: {
          libraryStatusChanged: { __typename: 'Library', id: 'movies', status: 'REFRESHING' },
        },
      },
    ])
    expect(framesAtEachReport).toEqual([1, 1])
  })

  it('shouldIgnoreTheEarlierSocketsHandshakeAfterTheIdentityChanges', async () => {
    const { subscribe, transport, framesAtEachReport } = setup()
    subscribe()
    await settle()
    const earlier = latestSocket()

    transport.replaceSocket()
    await settle()
    const next = latestSocket()
    earlier.accept()
    await settle()
    next.accept()
    await settle()

    expect(next).not.toBe(earlier)
    expect(earlier.subscriptionIds()).toEqual([])
    expect(next.subscriptionIds()).toHaveLength(1)
    expect(framesAtEachReport).toEqual([1])
  })

  it('shouldOpenNoSocketWhenTheIdentityChangesWithNothingSubscribed', async () => {
    const { transport } = setup()

    transport.replaceSocket()
    await settle()

    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('shouldReportEachSocketOnceItHasSentTheSubscribeFrames', async () => {
    const { subscribe, framesAtEachReport } = setup()
    const first = await connectAndSubscribe(subscribe)
    expect(framesAtEachReport).toEqual([1])

    first.serverClose(1001, 'Going away')
    await vi.advanceTimersByTimeAsync(1_000)
    latestSocket().accept()
    await settle()

    expect(framesAtEachReport).toEqual([1, 1])
  })

  it('shouldReportNothingForASocketStoppedBeforeItsSubscribeFramesWent', async () => {
    const { subscribe, transport, framesAtEachReport } = setup()
    subscribe()
    await settle()

    latestSocket().accept()
    transport.stop()
    await settle()

    expect(framesAtEachReport).toEqual([])
  })

  it('shouldStopReportingRecoveryToARemovedListener', async () => {
    const { subscribe, transport } = setup()
    const listener = vi.fn()
    const remove = transport.onMissedChanges(listener)
    const first = await connectAndSubscribe(subscribe)

    remove()
    first.serverClose(1001, 'Going away')
    await vi.advanceTimersByTimeAsync(1_000)
    latestSocket().accept()
    await settle()

    expect(listener).toHaveBeenCalledOnce()
  })

  it('shouldSubscribeAgainOnTheSameSocketAndRecoverWhenOneOperationOverflows', async () => {
    const { subscribe, subscribeToAdditions, results, framesAtEachReport } = setup()
    subscribeToAdditions()
    const socket = await connectAndSubscribe(subscribe)
    const [first] = socket.subscriptionIds()

    socket.deliver({ type: 'error', id: first, payload: errorCodes('SUBSCRIPTION_OVERFLOW') })
    await vi.advanceTimersByTimeAsync(1_000)
    // The fake clock holds a zero-delay timer set during a tick for one millisecond.
    await vi.advanceTimersByTimeAsync(1)

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(socket.subscriptionIds()).toHaveLength(3)
    expect(results).toEqual([])
    expect(framesAtEachReport).toEqual([2, 3])
  })

  it('shouldReconnectAndRecoverWhenTheOnlyOperationOverflows', async () => {
    const { subscribe, framesAtEachReport } = setup()
    const socket = await connectAndSubscribe(subscribe)

    socket.deliver({
      type: 'error',
      id: socket.subscriptionIds()[0],
      payload: errorCodes('SUBSCRIPTION_OVERFLOW'),
    })
    await vi.advanceTimersByTimeAsync(1_000)
    const next = latestSocket()
    next.accept()
    await settle()

    expect(next).not.toBe(socket)
    expect(next.subscriptionIds()).toHaveLength(1)
    expect(framesAtEachReport).toEqual([1, 1])
  })

  it('shouldSubscribeAgainWhenAuthorizationIsUnavailable', async () => {
    const { subscribe, subscribeToAdditions, results, completed } = setup()
    subscribeToAdditions()
    const socket = await connectAndSubscribe(subscribe)
    const [first] = socket.subscriptionIds()

    socket.deliver({
      type: 'next',
      id: first,
      payload: { errors: errorCodes('AUTHORIZATION_UNAVAILABLE') },
    })
    socket.deliver({ type: 'complete', id: first })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(socket.subscriptionIds()).toHaveLength(3)
    expect(results).toEqual([])
    expect(completed).not.toHaveBeenCalled()
  })

  it('shouldDoubleTheResubscribeDelayWhileTheOnlyOperationKeepsFailing', async () => {
    const { subscribe } = setup()
    let socket = await connectAndSubscribe(subscribe)

    for (const delay of [1_000, 2_000, 4_000]) {
      socket.deliver({
        type: 'error',
        id: socket.subscriptionIds()[0],
        payload: errorCodes('AUTHORIZATION_UNAVAILABLE'),
      })
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(latestSocket()).toBe(socket)
      await vi.advanceTimersByTimeAsync(1)
      expect(latestSocket()).not.toBe(socket)
      socket = latestSocket()
      socket.accept()
      await settle()
    }
  })

  it('shouldKeepGrowingTheResubscribeDelayWhileAnotherOperationReceivesChanges', async () => {
    const { subscribe, subscribeToAdditions } = setup()
    subscribeToAdditions()
    const socket = await connectAndSubscribe(subscribe)
    const [additions, statuses] = socket.subscriptionIds()

    socket.deliver({ type: 'error', id: statuses, payload: errorCodes('SUBSCRIPTION_OVERFLOW') })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(socket.subscriptionIds()).toHaveLength(3)
    socket.deliver({
      type: 'next',
      id: additions,
      payload: { data: { libraryAdded: { __typename: 'Library', id: 'shows' } } },
    })
    socket.deliver({
      type: 'error',
      id: socket.subscriptionIds()[2],
      payload: errorCodes('SUBSCRIPTION_OVERFLOW'),
    })
    await vi.advanceTimersByTimeAsync(1_999)

    expect(socket.subscriptionIds()).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(socket.subscriptionIds()).toHaveLength(4)
  })

  it('shouldStartTheResubscribeDelayOverOnceTheOperationReceivesAChange', async () => {
    const { subscribe, subscribeToAdditions, results } = setup()
    subscribeToAdditions()
    const socket = await connectAndSubscribe(subscribe)

    socket.deliver({
      type: 'error',
      id: socket.subscriptionIds()[1],
      payload: errorCodes('SUBSCRIPTION_OVERFLOW'),
    })
    await vi.advanceTimersByTimeAsync(1_000)
    socket.deliver(statusFrame(socket.subscriptionIds()[2], 'SCANNING'))
    socket.deliver({
      type: 'error',
      id: socket.subscriptionIds()[2],
      payload: errorCodes('SUBSCRIPTION_OVERFLOW'),
    })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(results).toHaveLength(1)
    expect(socket.subscriptionIds()).toHaveLength(4)
  })

  it('shouldReportMissedChangesAndKeepTheOperationWhenAChangeArrivesWithAFailedField', async () => {
    const { subscribe, results, completed, framesAtEachReport } = setup()
    const socket = await connectAndSubscribe(subscribe)
    const [first] = socket.subscriptionIds()

    socket.deliver({
      type: 'next',
      id: first,
      payload: {
        data: { libraryStatusChanged: null },
        errors: [{ message: 'Status unavailable', path: ['libraryStatusChanged', 'status'] }],
      },
    })
    socket.deliver(statusFrame(first, 'SCANNING'))
    await settle()

    expect(framesAtEachReport).toEqual([1, 1])
    expect(results.at(-1)).toEqual({
      data: { libraryStatusChanged: { __typename: 'Library', id: 'movies', status: 'SCANNING' } },
    })
    expect(socket.subscriptionIds()).toHaveLength(1)
    expect(completed).not.toHaveBeenCalled()
  })

  it('shouldEndTheOperationWithoutSubscribingAgainWhenForbidden', async () => {
    const { subscribe, results, completed, framesAtEachReport } = setup()
    const socket = await connectAndSubscribe(subscribe)
    const [first] = socket.subscriptionIds()

    socket.deliver({ type: 'next', id: first, payload: { errors: errorCodes('FORBIDDEN') } })
    socket.deliver({ type: 'complete', id: first })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(socket.subscriptionIds()).toHaveLength(1)
    expect(results).toHaveLength(1)
    expect(results[0].error).toMatchObject({ errors: errorCodes('FORBIDDEN') })
    expect(completed).toHaveBeenCalledOnce()
    expect(framesAtEachReport).toEqual([1])
  })

  it('shouldEndTheOperationWhenTheServerRefusesIt', async () => {
    const { subscribe, results, completed } = setup()
    const socket = await connectAndSubscribe(subscribe)
    const [first] = socket.subscriptionIds()

    socket.deliver({ type: 'error', id: first, payload: errorCodes('TOO_MANY_OPERATIONS') })
    await vi.advanceTimersByTimeAsync(120_000)

    expect(socket.subscriptionIds()).toHaveLength(1)
    expect(results[0].error).toMatchObject({ errors: errorCodes('TOO_MANY_OPERATIONS') })
    expect(completed).toHaveBeenCalledOnce()
  })

  it('shouldNotSubscribeAgainForAnOperationThatEndedWhileWaiting', async () => {
    const { subscribe, framesAtEachReport } = setup()
    const operation = subscribe()
    await settle()
    const socket = latestSocket()
    socket.accept()
    await settle()

    socket.deliver({
      type: 'error',
      id: socket.subscriptionIds()[0],
      payload: errorCodes('SUBSCRIPTION_OVERFLOW'),
    })
    await settle()
    operation.unsubscribe()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(socket.subscriptionIds()).toHaveLength(1)
    expect(framesAtEachReport).toEqual([1])
  })

  it('shouldCloseTheSocketWhenTheLastOperationEnds', async () => {
    const { subscribe } = setup()
    const operation = subscribe()
    await settle()
    const socket = latestSocket()
    socket.accept()
    await settle()

    operation.unsubscribe()
    await settle()

    expect(socket.sent.at(-1)).toEqual({ type: 'complete', id: socket.subscriptionIds()[0] })
    expect(socket.closedWith?.code).toBe(1000)
  })
})
