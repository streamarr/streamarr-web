import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { describe, expect, it } from 'vitest'
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
})
