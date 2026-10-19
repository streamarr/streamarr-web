import { act, screen, waitFor } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { watchingMovie, watchingEpisode } from '../test/continueWatchingFixtures'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { meFixture, profileFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

describe('Continue Watching event cards', () => {
  it.each([
    ['Movie', watchingMovie],
    ['Episode', watchingEpisode],
  ] as const)('shouldShowAnUncached%sFromTheEventWithoutReadingHomeAgain', async (_kind, make) => {
    const item = make({ id: 'new-item', orderKey: '10' })
    let reads = 0
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({ scope: 'profile', profiles: [profileFixture({ selected: true })] }),
          },
        }),
      ),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('Home', () => {
        reads++
        return HttpResponse.json({
          data: {
            continueWatching: {
              edges: [],
              pageInfo: {
                hasNextPage: false,
                hasPreviousPage: false,
                startCursor: null,
                endCursor: null,
              },
            },
            libraries: [],
          },
        })
      }),
    )
    const socket = serveGraphqlSocket()
    renderAppAt('/')
    await waitFor(() => expect(socket.isLive('WatchStateChanged')).toBe(true))
    await waitFor(() => expect(reads).toBe(2))
    act(() =>
      socket.publish('WatchStateChanged', {
        data: {
          watchStateChanged: {
            __typename: 'WatchStateChange',
            items: [item],
            continueWatching: [
              {
                itemId: item.id,
                edge: {
                  __typename: 'ContinueWatchingEdge',
                  cursor: 'cursor-new',
                  orderKey: '10',
                  node: item,
                },
              },
            ],
          },
        },
      }),
    )
    expect(await screen.findByRole('link', { name: /new-item/ })).toBeVisible()
    expect(reads).toBe(2)
  })
})
