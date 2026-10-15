import { gql } from '@apollo/client'
import { createMemoryHistory } from '@tanstack/react-router'
import { waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { MeDocument } from './graphql/generated/graphql'
import { createAppRouter } from './router'
import { serveGraphqlSocket } from './test/graphqlSocket'
import { server } from './test/server'

const STATUS_CHANGED = gql`
  subscription LibraryStatusChanged {
    libraryStatusChanged {
      id
      status
    }
  }
`

function subscribeAt(path: string, renewal?: Parameters<typeof createAppRouter>[1]) {
  const app = createAppRouter(createMemoryHistory({ initialEntries: [path] }), renewal)
  const completed = vi.fn()
  app.apolloClient.subscribe({ query: STATUS_CHANGED }).subscribe({ complete: completed })
  return { ...app, completed }
}

describe('app composition', () => {
  it('shouldCarrySubscriptionsOverTheSameOriginSocket', async () => {
    const socket = serveGraphqlSocket()

    subscribeAt('/')

    await waitFor(() => expect(socket.isLive('LibraryStatusChanged')).toBe(true))
  })

  it('shouldCloseTheSubscriptionSocketWhenTheSessionIsEvicted', async () => {
    const socket = serveGraphqlSocket()
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { apolloClient, completed, router } = subscribeAt('/settings/server/libraries')
    await waitFor(() => expect(socket.isLive('LibraryStatusChanged')).toBe(true))

    await apolloClient.query({ query: MeDocument }).catch(() => {})

    await waitFor(() => expect(completed).toHaveBeenCalledOnce())
    await waitFor(() => expect(socket.openSockets()).toBe(0))
    expect(router.history.location.pathname).toBe('/login')
  })

  it('shouldSignOutWhenTheSocketCannotRenewTheSession', async () => {
    const socket = serveGraphqlSocket()
    const renewal = { refreshNow: vi.fn(async () => ({ kind: 'rejected' as const })) }
    const { completed, router } = subscribeAt('/settings/server/libraries', renewal)
    await waitFor(() => expect(socket.isLive('LibraryStatusChanged')).toBe(true))

    socket.closeAll(4100, 'Access token expired')

    await waitFor(() => expect(router.history.location.pathname).toBe('/login'))
    expect(renewal.refreshNow).toHaveBeenCalledOnce()
    expect(completed).toHaveBeenCalledOnce()
    expect(socket.state.connections).toBe(1)
  })
})
