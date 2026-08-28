import { setupServer } from 'msw/node'

// Per-test handlers are registered with server.use(...); the shared server has none by default
// so an unhandled request fails loudly.
export const server = setupServer()
