import cases from '../test/contracts/live-lists.json'
import { watchingMovie, watchingConnection } from '../test/continueWatchingFixtures'
import { showContinueWatching, CONTINUE_WATCHING_LIMIT } from './watchStateLists'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApolloClient } from '../graphql/client'
import {
  HomeDocument,
  MovieWatchStateFragmentDoc,
  type WatchStatus,
} from '../graphql/generated/graphql'
import { createSubscriptionTransport } from '../graphql/subscriptionTransport'
import {
  connectAndSubscribe,
  FakeWebSocket,
  latestSocket,
  settle,
  type Frame,
} from '../test/fakeWebSocket'
import { subscribeToWatchStateChanges } from './watchStateChanges'

function setup() {
  const transport = createSubscriptionTransport({
    url: 'wss://streamarr.test/graphql',
    renewal: { refreshNow: async () => ({ kind: 'renewed', expiresAt: '2026-10-16T12:00:00Z' }) },
    onSignedOut: vi.fn(),
    webSocketImpl: FakeWebSocket,
    random: () => 1,
  })
  const client = createApolloClient(vi.fn(), transport.link)
  const watchStateOf = (id: string) =>
    client.cache.readFragment({
      fragment: MovieWatchStateFragmentDoc,
      fragmentName: 'MovieWatchState',
      id: client.cache.identify({ __typename: 'Movie', id }),
    })
  const watchStatusOf = (id: string) => watchStateOf(id)?.watchStatus
  return { client, transport, watchStateOf, watchStatusOf }
}

function movieChange(
  id: string,
  subscriptionId: string,
  watchStatus: WatchStatus,
  watchProgress: object | null = null,
): Frame {
  return {
    type: 'next',
    id: subscriptionId,
    payload: {
      data: {
        watchStateChanged: {
          continueWatching: [],
          __typename: 'WatchStateChange',
          items: [{ __typename: 'Movie', id, watchStatus, watchProgress }],
        },
      },
    },
  }
}

// Long enough for any resubscribe delay the transport could schedule.
const PAST_EVERY_RETRY_MS = 60_000

describe('subscribeToWatchStateChanges', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldDropAChangeFromTheEarlierProfilesSocketAfterAProfileSwitch', async () => {
    const { client, transport, watchStatusOf } = setup()
    const earlier = await connectAndSubscribe(() => subscribeToWatchStateChanges(client))
    const earlierId = earlier.subscriptionIds()[0]

    transport.replaceSocket()
    const reset = client.resetStore()
    earlier.deliver(movieChange('m1', earlierId, 'WATCHED'))
    await reset
    await settle()
    const next = latestSocket()
    next.accept()
    await settle()

    expect(watchStatusOf('m1')).toBeUndefined()

    next.deliver(movieChange('m2', next.subscriptionIds()[0], 'IN_PROGRESS'))
    await settle()

    expect(watchStatusOf('m2')).toBe('IN_PROGRESS')
  })

  it('shouldKeepTheCachedValueOfAFieldThatFailedAndApplyTheOtherItems', async () => {
    const { client, watchStateOf, watchStatusOf } = setup()
    const resumed = { positionSeconds: 600, percentComplete: 10, durationSeconds: 6000 }
    const socket = await connectAndSubscribe(() => subscribeToWatchStateChanges(client))
    socket.deliver(
      movieChange('m1', socket.subscriptionIds()[0], 'IN_PROGRESS', {
        __typename: 'WatchProgress',
        ...resumed,
      }),
    )

    socket.deliver({
      type: 'next',
      id: socket.subscriptionIds()[0],
      payload: {
        data: {
          watchStateChanged: {
            continueWatching: [],
            __typename: 'WatchStateChange',
            items: [
              { __typename: 'Movie', id: 'm1', watchStatus: 'IN_PROGRESS', watchProgress: null },
              { __typename: 'Movie', id: 'm2', watchStatus: 'WATCHED', watchProgress: null },
            ],
          },
        },
        errors: [
          { message: 'Timed out', path: ['watchStateChanged', 'items', 0, 'watchProgress'] },
        ],
      },
    })
    await settle()

    expect(watchStatusOf('m2')).toBe('WATCHED')
    expect(watchStateOf('m1')?.watchProgress).toMatchObject(resumed)
  })

  it.each(['failed-edge', 'missing-node', 'nonmember'] as const)(
    'shouldUseExplicitMembershipAndIndexedErrorPathsFor%s',
    async (outcome) => {
      const { client, watchStatusOf } = setup()
      const release = showContinueWatching(client.cache)
      const movie = watchingMovie({ id: 'm1', orderKey: '10' })
      const query = {
        query: HomeDocument,
        variables: { continueWatchingFirst: CONTINUE_WATCHING_LIMIT },
      }
      client.cache.writeQuery({
        ...query,
        data: {
          continueWatching: watchingConnection([
            movie,
            watchingMovie({ id: 'm2', orderKey: '20' }),
          ]),
          libraries: [],
        },
      })
      const socket = await connectAndSubscribe(() => subscribeToWatchStateChanges(client))
      socket.deliver({
        type: 'next',
        id: socket.subscriptionIds()[0],
        payload: {
          data: {
            watchStateChanged: {
              items: [movie],
              continueWatching: [
                {
                  itemId: 'm1',
                  edge:
                    outcome === 'missing-node'
                      ? {
                          __typename: 'ContinueWatchingEdge',
                          cursor: 'cursor',
                          orderKey: '10',
                          node: null,
                        }
                      : null,
                },
                { itemId: 'm2', edge: null },
              ],
            },
          },
          ...(outcome === 'failed-edge'
            ? {
                errors: [
                  {
                    message: 'Unavailable',
                    path: ['watchStateChanged', 'continueWatching', 0, 'edge', 'orderKey'],
                  },
                ],
              }
            : {}),
        },
      })
      await settle()
      expect(
        client.cache.readQuery(query)?.continueWatching.edges.map((edge) => edge?.node?.id),
      ).toEqual(outcome === 'nonmember' ? [] : ['m1'])
      expect(watchStatusOf('m1')).toBe('IN_PROGRESS')
      release()
    },
  )

  it.each(cases.edgeCases)('shouldApplySharedEdgeCase: $name', async (scenario) => {
    const { client, watchStatusOf } = setup()
    const release = showContinueWatching(client.cache)
    const query = {
      query: HomeDocument,
      variables: { continueWatchingFirst: CONTINUE_WATCHING_LIMIT },
    }
    client.cache.writeQuery({
      ...query,
      data: {
        continueWatching: watchingConnection(
          ['a', 'b'].map((id) => watchingMovie({ id, orderKey: id })),
        ),
        libraries: [],
      },
    })
    const socket = await connectAndSubscribe(() => subscribeToWatchStateChanges(client))
    socket.deliver({
      type: 'next',
      id: socket.subscriptionIds()[0],
      payload: {
        data: {
          watchStateChanged: {
            __typename: 'WatchStateChange',
            items: [
              { __typename: 'Movie', id: 'movie-1', watchStatus: 'WATCHED', watchProgress: null },
              null,
            ],
            continueWatching:
              scenario.changes?.map((change) => ({
                ...change,
                edge:
                  change.edge === null
                    ? null
                    : {
                        ...change.edge,
                        __typename: 'ContinueWatchingEdge',
                        cursor: 'cursor',
                        node: null,
                      },
              })) ?? null,
          },
        },
        errors: scenario.errorPaths.map((path) => ({ message: 'Unavailable', path })),
      },
    })
    await settle()
    expect(watchStatusOf('movie-1')).toBe('WATCHED')
    expect(
      client.cache.readQuery(query)?.continueWatching.edges.map((edge) => edge?.node?.id),
    ).toEqual(scenario.expected)
    release()
  })

  it.each(['failed-list', 'failed-change'] as const)(
    'shouldDropAHiddenShelfWhenItsMembershipIsUnknownFor%s',
    async (outcome) => {
      const { client, watchStatusOf } = setup()
      const query = {
        query: HomeDocument,
        variables: { continueWatchingFirst: CONTINUE_WATCHING_LIMIT },
      }
      client.cache.writeQuery({
        ...query,
        data: {
          continueWatching: watchingConnection([watchingMovie({ id: 'a', orderKey: 'a' })]),
          libraries: [],
        },
      })
      const socket = await connectAndSubscribe(() => subscribeToWatchStateChanges(client))
      socket.deliver({
        type: 'next',
        id: socket.subscriptionIds()[0],
        payload: {
          data: {
            watchStateChanged: {
              __typename: 'WatchStateChange',
              items: [
                { __typename: 'Movie', id: 'a', watchStatus: 'WATCHED', watchProgress: null },
              ],
              continueWatching: outcome === 'failed-list' ? null : [{ itemId: 'a', edge: null }],
            },
          },
          errors: [
            {
              message: 'Unavailable',
              path:
                outcome === 'failed-list'
                  ? ['watchStateChanged', 'continueWatching']
                  : ['watchStateChanged', 'continueWatching', 0, 'edge'],
            },
          ],
        },
      })
      await settle()
      expect(watchStatusOf('a')).toBe('WATCHED')
      expect(client.cache.readQuery(query)).toBeNull()
    },
  )

  it('shouldNotSubscribeAgainAfterTheServerForbidsTheChanges', async () => {
    const { client } = setup()
    const socket = await connectAndSubscribe(() => subscribeToWatchStateChanges(client))

    socket.deliver({
      type: 'error',
      id: socket.subscriptionIds()[0],
      payload: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }],
    })
    await vi.advanceTimersByTimeAsync(PAST_EVERY_RETRY_MS)

    const subscribes = FakeWebSocket.instances.flatMap((each) => each.subscriptionIds())
    expect(subscribes).toHaveLength(1)
  })

  it('shouldNotSubscribeAgainAfterTheChangesCompleteNormally', async () => {
    const { client } = setup()
    const socket = await connectAndSubscribe(() => subscribeToWatchStateChanges(client))

    socket.deliver({ type: 'complete', id: socket.subscriptionIds()[0] })
    await vi.advanceTimersByTimeAsync(PAST_EVERY_RETRY_MS)

    const subscribes = FakeWebSocket.instances.flatMap((each) => each.subscriptionIds())
    expect(subscribes).toHaveLength(1)
  })

  it('shouldEndTheOperationOnceTheSubscriberStops', async () => {
    const { client } = setup()
    let stop = () => {}
    const socket = await connectAndSubscribe(() => {
      stop = subscribeToWatchStateChanges(client)
    })

    stop()
    await settle()

    expect(socket.sent.at(-1)).toEqual({ type: 'complete', id: socket.subscriptionIds()[0] })
  })
})
