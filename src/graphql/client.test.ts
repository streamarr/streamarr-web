import { HttpResponse, graphql } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/server'
import { createApolloClient } from './client'
import { ME_QUERY } from './operations'

const ME = {
  accountId: '11111111-1111-1111-1111-111111111111',
  email: 'owner@example.com',
  displayName: 'Owner',
  role: 'ADMIN',
  scope: 'profile',
  memberships: [],
}

describe('apollo client', () => {
  it('shouldOmitCsrfHeaderWhenNoTokenCookieIssuedYet', async () => {
    document.cookie = 'XSRF-TOKEN=; max-age=0'
    let header: string | null = 'unset'
    server.use(
      graphql.query('Me', ({ request }) => {
        header = request.headers.get('X-XSRF-TOKEN')
        return HttpResponse.json({ data: { me: ME } })
      }),
    )

    await createApolloClient(vi.fn()).query({ query: ME_QUERY })

    expect(header).toBeNull()
  })

  it('shouldAttachCsrfHeaderMatchingTheCookieOnEveryOperation', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-graphql'
    const headers: (string | null)[] = []
    server.use(
      graphql.query('Me', ({ request }) => {
        headers.push(request.headers.get('X-XSRF-TOKEN'))
        return HttpResponse.json({ data: { me: ME } })
      }),
    )
    const client = createApolloClient(vi.fn())

    await client.query({ query: ME_QUERY })
    // The token rotates with the session, so it is read per request, not once at construction.
    document.cookie = 'XSRF-TOKEN=csrf-rotated'
    await client.query({ query: ME_QUERY, fetchPolicy: 'network-only' })

    expect(headers).toEqual(['csrf-graphql', 'csrf-rotated'])
  })
})
