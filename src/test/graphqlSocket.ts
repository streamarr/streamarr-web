import { ws, type WebSocketHandlerConnection } from 'msw'
import { server } from './server'

/** The socket URL the app derives from the jsdom origin. */
export const GRAPHQL_SOCKET_URL = 'wss://streamarr.test/graphql'

type SocketClient = WebSocketHandlerConnection['client']
type Payload = { data: unknown } | { errors: { message: string; extensions?: object }[] }

interface Operation {
  client: SocketClient
  operationName: string
}

const graphqlSocket = ws.link(GRAPHQL_SOCKET_URL)

/**
 * Plays the server's half of graphql-transport-ws for one test: it acknowledges every
 * connection and keeps each subscribe by id, so a test can publish a change to every live
 * operation of a name.
 */
export function serveGraphqlSocket() {
  const operations = new Map<string, Operation>()
  const clients = new Set<SocketClient>()
  const state = { connections: 0, subscribes: [] as string[] }

  const send = (client: SocketClient, frame: object) => client.send(JSON.stringify(frame))
  const live = (operationName: string) =>
    [...operations].filter(([, operation]) => operation.operationName === operationName)

  server.use(
    graphqlSocket.addEventListener('connection', ({ client }) => {
      state.connections++
      clients.add(client)
      client.addEventListener('close', () => {
        clients.delete(client)
        for (const [id, operation] of operations) {
          if (operation.client === client) operations.delete(id)
        }
      })
      client.addEventListener('message', ({ data }) => {
        // graphql-ws sends every frame as text.
        if (typeof data !== 'string') return
        const frame = JSON.parse(data) as {
          type: string
          id?: string
          payload?: { operationName?: string }
        }
        if (frame.type === 'connection_init') send(client, { type: 'connection_ack' })
        if (frame.type === 'ping') send(client, { type: 'pong' })
        if (frame.type === 'complete') operations.delete(frame.id!)
        if (frame.type === 'subscribe') {
          const operationName = frame.payload?.operationName ?? ''
          operations.set(frame.id!, { client, operationName })
          state.subscribes.push(operationName)
        }
      })
    }),
  )

  return {
    state,
    isLive: (operationName: string) => live(operationName).length > 0,
    publish(operationName: string, payload: Payload) {
      for (const [id, { client }] of live(operationName))
        send(client, { type: 'next', id, payload })
    },
    complete(operationName: string) {
      for (const [id, { client }] of live(operationName)) {
        operations.delete(id)
        send(client, { type: 'complete', id })
      }
    },
    closeAll(code: number, reason = '') {
      for (const client of clients) client.close(code, reason)
    },
    openSockets: () => clients.size,
  }
}
