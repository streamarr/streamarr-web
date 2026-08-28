// Deterministic API stub for the browser E2E: speaks just enough of the server's auth contract
// to drive the service worker's renewal decisions. The spec switches behavior through
// POST /__test/mode, which also invalidates the simulated access token.
import { createServer } from 'node:http'

const port = Number(process.env.STUB_PORT ?? 5198)

let mode = 'renewable'
let accessValid = false

const household = { __typename: 'HouseholdSummary', id: 'household-1', name: 'Dev Household' }
const profile = {
  __typename: 'SelectableProfile',
  id: 'profile-1',
  name: 'Dev',
  picture: null,
  kind: 'ADULT',
  personal: true,
  pinConfigured: false,
  locked: false,
  selected: true,
}
const me = {
  __typename: 'Me',
  accountId: 'account-1',
  email: 'dev@streamarr.test',
  displayName: 'Dev Admin',
  serverAdmin: true,
  scope: 'profile',
  deviceBound: false,
  householdRole: 'ADMIN',
  household,
  contextHousehold: household,
  usableHouseholds: {
    __typename: 'UsableHouseholdConnection',
    edges: [
      {
        __typename: 'UsableHouseholdEdge',
        node: { __typename: 'UsableHousehold', membership: true, household },
      },
    ],
  },
  selectableProfiles: {
    __typename: 'SelectableProfileConnection',
    edges: [{ __typename: 'SelectableProfileEdge', node: profile }],
  },
  selectedProfile: profile,
}

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

// Every request body is drained before responding: leaving it unread kills the keep-alive
// socket the dev proxy pools, which stalls the request the worker replays on it.
const server = createServer((request, response) => {
  request.setEncoding('utf8')
  let raw = ''
  request.on('data', (chunk) => (raw += chunk))
  request.on('end', () => route(request, response, raw))
})
server.on('error', (error) => {
  console.error(`stub server failed on port ${port}:`, error)
  process.exit(1)
})
server.listen(port)

function route(request, response, raw) {
  const { pathname } = new URL(request.url, `http://localhost:${port}`)

  if (request.method === 'POST' && pathname === '/__test/mode') {
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return json(response, 400, { code: 'BAD_JSON' })
    }
    const next = body?.mode
    if (next !== 'renewable' && next !== 'rejected') {
      return json(response, 400, { code: 'BAD_MODE' })
    }
    mode = next
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
