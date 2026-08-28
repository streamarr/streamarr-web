// Deterministic API stub for the browser E2E: speaks just enough of the server's auth contract
// to drive the service worker's renewal decisions. The spec switches behavior through
// POST /__test/mode, which also invalidates the simulated access token.
import { createServer } from 'node:http'

const port = Number(process.env.STUB_PORT ?? 5198)

let mode = 'renewable'
let accessValid = false

const me = {
  __typename: 'Me',
  accountId: 'account-1',
  email: 'dev@streamarr.test',
  displayName: 'Dev Admin',
  role: 'ADMIN',
  scope: 'profile',
  memberships: [
    {
      __typename: 'Membership',
      householdId: 'household-1',
      householdName: 'Dev Household',
      householdRole: 'OWNER',
      profiles: [{ __typename: 'SelectableProfile', id: 'profile-1', name: 'Dev', active: true }],
    },
  ],
}

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

// Every request body is drained before responding: leaving it unread kills the keep-alive
// socket the dev proxy pools, which stalls the request the worker replays on it.
createServer((request, response) => {
  let raw = ''
  request.on('data', (chunk) => (raw += chunk))
  request.on('end', () => route(request, response, raw))
})
  .listen(port)

function route(request, response, raw) {
  const { pathname } = new URL(request.url, `http://localhost:${port}`)

  if (request.method === 'POST' && pathname === '/__test/mode') {
    mode = JSON.parse(raw).mode
    accessValid = false
    return json(response, 200, { mode })
  }
  if (request.method === 'GET' && pathname === '/api/auth/status') {
    return json(response, 200, { setupComplete: true, devicePairingEnabled: false })
  }
  if (request.method === 'POST' && pathname === '/api/auth/refresh') {
    if (mode === 'rejected') {
      return json(response, 401, {
        code: 'INVALID_REFRESH_TOKEN',
        message: 'The refresh token is unknown or expired.',
      })
    }
    accessValid = true
    return json(response, 200, {
      accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      scope: 'profile',
    })
  }
  if (request.method === 'POST' && pathname === '/graphql') {
    if (!accessValid) {
      return json(response, 401, { code: 'EXPIRED_TOKEN', message: 'Authentication is required.' })
    }
    return json(response, 200, { data: { me } })
  }
  json(response, 404, { code: 'NOT_FOUND', message: pathname })
}
