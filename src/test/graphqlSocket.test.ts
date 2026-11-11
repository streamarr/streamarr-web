import { describe, expect, it, vi } from 'vitest'
import { GRAPHQL_SOCKET_URL, serveGraphqlSocket } from './graphqlSocket'

describe('serveGraphqlSocket', () => {
  it('shouldReportNoLiveOperationAndNoOpenSocketWhenItHasClosedEverySocket', async () => {
    const socket = serveGraphqlSocket()
    const client = new WebSocket(GRAPHQL_SOCKET_URL)
    client.addEventListener('open', () => {
      client.send(
        JSON.stringify({ type: 'subscribe', id: '1', payload: { operationName: 'Changed' } }),
      )
    })
    await vi.waitFor(() => expect(socket.isLive('Changed')).toBe(true))

    socket.closeAll(1001, 'Going away')

    expect(socket.isLive('Changed')).toBe(false)
    expect(socket.openSockets()).toBe(0)
  })
})
