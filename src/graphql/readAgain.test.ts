import { gql } from '@apollo/client'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '../test/deferred'
import { server } from '../test/server'
import { createApolloClient } from './client'
import { isReading } from './readAgain'

const LIBRARIES = gql`
  query Libraries {
    libraries {
      id
      name
    }
  }
`

describe('isReading', () => {
  it('shouldSayAQueryReadsWhileItsOwnReadIsOutAndNotOnceItAnswers', async () => {
    const answer = deferred()
    server.use(
      graphql.query('Libraries', async () => {
        await answer.promise
        return HttpResponse.json({ data: { libraries: [] } })
      }),
    )
    const query = createApolloClient(vi.fn()).watchQuery({ query: LIBRARIES })
    query.subscribe({})

    expect(isReading(query)).toBe(true)
    answer.resolve()

    await vi.waitFor(() => expect(isReading(query)).toBe(false))
  })
})
