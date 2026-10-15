import type { Page, WebSocketRoute } from '@playwright/test'

type Payload = { data: unknown } | { errors: { message: string; extensions?: object }[] }

/**
 * Answers the page's GraphQL WebSocket inside the browser, speaking the server's half of
 * graphql-transport-ws: it acknowledges each connection and keeps each subscribe by id, so a spec
 * can publish a change to every live operation of a name. It never reaches the dev proxy.
 */
export async function routeGraphqlSocket(page: Page) {
  const sockets = new Set<WebSocketRoute>()
  const operations = new Map<string, { socket: WebSocketRoute; operationName: string }>()
  const state = { connections: 0, subscribes: [] as string[] }

  await page.routeWebSocket(/\/graphql$/, (socket) => {
    state.connections++
    sockets.add(socket)
    socket.onClose(() => {
      sockets.delete(socket)
      for (const [id, operation] of operations) {
        if (operation.socket === socket) operations.delete(id)
      }
    })
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        type: string
        id?: string
        payload?: { operationName?: string }
      }
      if (frame.type === 'connection_init') socket.send(JSON.stringify({ type: 'connection_ack' }))
      if (frame.type === 'complete') operations.delete(frame.id!)
      if (frame.type === 'subscribe') {
        const operationName = frame.payload?.operationName ?? ''
        operations.set(frame.id!, { socket, operationName })
        state.subscribes.push(operationName)
      }
    })
  })

  const live = (operationName: string) =>
    [...operations].filter(([, operation]) => operation.operationName === operationName)

  return {
    state,
    isLive: (operationName: string) => live(operationName).length > 0,
    publish(operationName: string, payload: Payload) {
      for (const [id, { socket }] of live(operationName)) {
        socket.send(JSON.stringify({ type: 'next', id, payload }))
      }
    },
    async closeAll(code: number, reason = '') {
      await Promise.all([...sockets].map((socket) => socket.close({ code, reason })))
    },
  }
}
