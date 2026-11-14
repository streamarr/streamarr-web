import { ws, type WebSocketHandlerConnection } from 'msw'
import { onTestFinished } from 'vitest'
import { server } from './server'

/** The socket URL the app derives from the jsdom origin. */
export const GRAPHQL_SOCKET_URL = 'wss://streamarr.test/graphql'

/** How long a test waits for a reconnect. A closed socket waits up to a second before it tries. */
export const SOCKET_RECONNECT_DEADLINE_MS = 3_000

type SocketClient = WebSocketHandlerConnection['client']
type PayloadError = { message: string; path?: readonly (string | number)[]; extensions?: object }
type Payload = { data: unknown; errors?: PayloadError[] } | { errors: PayloadError[] }

interface Operation {
  client: SocketClient
  operationName: string
}

const graphqlSocket = ws.link(GRAPHQL_SOCKET_URL)

/**
 * Plays the server's half of graphql-transport-ws for one test. Connections are acknowledged
 * unless `acknowledge: false` leaves the handshake pending. Each subscribe is kept by id, so a
 * test can publish a change to every live operation of a name. `documents` holds its query text.
 */
export function serveGraphqlSocket({ acknowledge = true } = {}) {
  const operations = new Map<string, Operation>()
  const clients = new Set<SocketClient>()
  const state = {
    connections: 0,
    subscribes: [] as string[],
    documents: new Map<string, string>(),
    variables: new Map<string, Record<string, unknown>>(),
  }

  const send = (client: SocketClient, frame: object) => client.send(JSON.stringify(frame))
  const live = (operationName: string) =>
    [...operations].filter(([, operation]) => operation.operationName === operationName)
  const forget = (client: SocketClient) => {
    clients.delete(client)
    for (const [id, operation] of operations) {
      if (operation.client === client) operations.delete(id)
    }
  }

  server.use(
    graphqlSocket.addEventListener('connection', ({ client }) => {
      state.connections++
      clients.add(client)
      client.addEventListener('close', () => forget(client))
      client.addEventListener('message', (event) => {
        // A test's handler replaces the quiet default installed by the shared setup.
        event.stopPropagation()
        const { data } = event
        // graphql-ws sends every frame as text.
        if (typeof data !== 'string') return
        const frame = JSON.parse(data) as {
          type: string
          id?: string
          payload?: { operationName?: string; query?: string; variables?: Record<string, unknown> }
        }
        if (frame.type === 'connection_init' && acknowledge)
          send(client, { type: 'connection_ack' })
        if (frame.type === 'ping') send(client, { type: 'pong' })
        if (frame.type === 'complete') operations.delete(frame.id!)
        if (frame.type === 'subscribe') {
          const operationName = frame.payload?.operationName ?? ''
          operations.set(frame.id!, { client, operationName })
          state.subscribes.push(operationName)
          state.documents.set(operationName, frame.payload?.query ?? '')
          state.variables.set(operationName, frame.payload?.variables ?? {})
        }
      })
    }),
  )

  const socket = {
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
      for (const client of [...clients]) {
        client.close(code, reason)
        // The close event arrives a microtask later, and a wait that began before it would still
        // find the closed socket's operations live.
        forget(client)
      }
    },
    openSockets: () => clients.size,
  }
  onTestFinished(() => socket.closeAll(1000))
  return socket
}
