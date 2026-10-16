import { expect, vi } from 'vitest'

export type Frame = { type: string; id?: string; payload?: unknown }

// Speaks the server's half of graphql-transport-ws. graphql-ws drives it through the browser
// WebSocket surface; each test plays the server by hand.
export class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readonly protocol: string
  readyState = FakeWebSocket.CONNECTING
  sent: Frame[] = []
  closedWith: { code?: number; reason?: string } | null = null
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null

  constructor(url: string, protocol: string) {
    this.url = url
    this.protocol = protocol
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as Frame)
  }

  // A browser fires close a task after close() returns, once the closing handshake ends.
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason }
    this.readyState = FakeWebSocket.CLOSING
    setTimeout(() => this.serverClose(code ?? 1000, reason ?? ''), 0)
  }

  accept() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
    this.deliver({ type: 'connection_ack' })
  }

  deliver(frame: Frame) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  serverClose(code: number, reason = '') {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }

  // A network drop after the handshake: the browser reports an error, then 1006.
  drop() {
    this.readyState = FakeWebSocket.CLOSED
    this.onerror?.(new Event('error'))
    this.onclose?.({ code: 1006, reason: '' })
  }

  refuseHandshake() {
    this.readyState = FakeWebSocket.CLOSED
    this.onerror?.(new Event('error'))
    this.onclose?.({ code: 1006, reason: '' })
  }

  subscriptionIds(): string[] {
    return this.sent.filter((frame) => frame.type === 'subscribe').map((frame) => frame.id!)
  }
}

export function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1)
  expect(socket).toBeDefined()
  return socket!
}

// graphql-ws awaits each step, so a handful of microtask turns lets one settle.
export async function settle() {
  await vi.advanceTimersByTimeAsync(0)
}

export async function connectAndSubscribe(subscribe: () => unknown): Promise<FakeWebSocket> {
  subscribe()
  await settle()
  const socket = latestSocket()
  socket.accept()
  await settle()
  return socket
}
