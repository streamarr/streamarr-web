import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { describe, expect, it, vi } from 'vitest'
import { LibraryPageDocument } from '../graphql/generated/graphql'
import { createLibraryContents } from './libraryContents'
import { LIBRARY } from '../test/libraryContentsFixtures'

describe('Library contents lifecycle', () => {
  it('shouldRetainAnOperationFailureAsRetryableInsteadOfRememberingRemoval', () => {
    let fail: (() => void) | undefined
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: new ApolloLink(
        (operation) =>
          new Observable((observer) => {
            if (operation.operationName !== 'LibraryItemUpdated') return
            fail = () => {
              observer.next({
                errors: [{ message: 'Subscription error', extensions: { code: 'INTERNAL_ERROR' } }],
              })
              observer.complete()
            }
          }),
      ),
    })
    const contents = createLibraryContents({ client })
    try {
      contents.select({ variables: { libraryId: LIBRARY }, onItemsChanged: () => {} })
      expect(fail).toBeDefined()
      fail!()
      expect(contents.isRemoved(LIBRARY)).toBe(false)
      expect(contents.refusalFor(LIBRARY)).toBeDefined()
    } finally {
      contents.dispose()
      client.stop()
    }
  })
  it('shouldEvictAReleasedViewWithoutRefetchingThroughItsClosingObserver', async () => {
    vi.useFakeTimers()
    let reads = 0
    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: new ApolloLink(
        (operation) =>
          new Observable(() => {
            if (operation.operationName === 'LibraryPage') reads++
          }),
      ),
    })
    const variables = { libraryId: LIBRARY, first: 48, sort: {}, filter: {} }
    const query = { query: LibraryPageDocument, variables }
    const data = {
      library: {
        __typename: 'Library',
        id: LIBRARY,
        name: 'Movies',
        itemCount: 0,
        alphabetIndex: [],
        items: {
          edges: [],
          pageInfo: {
            hasPreviousPage: false,
            hasNextPage: false,
            startCursor: null,
            endCursor: null,
          },
        },
      },
    }
    client.cache.writeQuery({ ...query, data })
    const closingObserver = client.watchQuery(query).subscribe({})
    const contents = createLibraryContents({ client })
    try {
      contents.select({ variables, onItemsChanged: () => {} })
      await vi.runAllTimersAsync()
      expect(reads).toBe(0)
      contents.leaveUnlessWithin('/')
      await vi.runAllTimersAsync()
      expect(reads).toBe(0)
      expect(client.cache.readQuery(query)).toBeNull()
    } finally {
      closingObserver.unsubscribe()
      contents.dispose()
      client.stop()
      vi.useRealTimers()
    }
  })
})
