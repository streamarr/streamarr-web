// Deterministic API stub for the browser E2E: speaks just enough of the server's auth contract
// to drive the service worker's renewal decisions. The spec switches behavior through
// POST /__test/mode, which also invalidates the simulated access token. It also accepts the
// GraphQL WebSocket upgrade, so a spec can prove the dev proxy forwards one: GET /__test/socket
// reports each upgrade's headers and the live operations, and POST /__test/socket/publish sends
// a change to every live operation of a name.
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

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

const libraries = [
  { __typename: 'Library', id: 'movies', name: 'Movies', type: 'MOVIE' },
  { __typename: 'Library', id: 'series', name: 'TV Series', type: 'SERIES' },
]

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
server.on('upgrade', acceptGraphqlSocket)
server.listen(port)

const graphqlSockets = new WebSocketServer({ noServer: true })
const upgrades = []
const operations = new Map()

function acceptGraphqlSocket(request, socket, head) {
  if (new URL(request.url, `http://localhost:${port}`).pathname !== '/graphql') {
    socket.destroy()
    return
  }
  upgrades.push({
    host: request.headers.host ?? null,
    origin: request.headers.origin ?? null,
    cookie: request.headers.cookie ?? null,
  })
  graphqlSockets.handleUpgrade(request, socket, head, (client) => {
    client.on('message', (data) => answerFrame(client, JSON.parse(String(data))))
    client.on('close', () => {
      for (const [id, operation] of operations) {
        if (operation.client === client) operations.delete(id)
      }
    })
  })
}

function answerFrame(client, frame) {
  if (frame.type === 'connection_init') client.send(JSON.stringify({ type: 'connection_ack' }))
  if (frame.type === 'ping') client.send(JSON.stringify({ type: 'pong' }))
  if (frame.type === 'complete') operations.delete(frame.id)
  if (frame.type === 'subscribe') {
    operations.set(frame.id, { client, operationName: frame.payload?.operationName })
  }
}

function publish({ operationName, payload }) {
  for (const [id, operation] of operations) {
    if (operation.operationName === operationName) {
      operation.client.send(JSON.stringify({ type: 'next', id, payload }))
    }
  }
}

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
  if (request.method === 'GET' && pathname === '/__test/socket') {
    const live = [...operations.values()].map((operation) => operation.operationName)
    return json(response, 200, { upgrades, live })
  }
  if (request.method === 'POST' && pathname === '/__test/socket/publish') {
    publish(JSON.parse(raw))
    return json(response, 200, {})
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
    const { operationName } = JSON.parse(raw)
    if (operationName === 'Me') return json(response, 200, { data: { me } })
    if (operationName === 'Libraries') return json(response, 200, { data: { libraries } })
    if (operationName === 'Home') {
      return json(response, 200, {
        data: {
          continueWatching: { edges: [] },
          libraries: libraries.map((library) => ({ ...library, items: { edges: [] } })),
        },
      })
    }
    return json(response, 200, {
      errors: [{ message: `Unhandled test operation: ${operationName}` }],
    })
  }
  json(response, 404, { code: 'NOT_FOUND', message: pathname })
}
