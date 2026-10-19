import { InMemoryCache } from '@apollo/client'
import { describe, expect, it } from 'vitest'
import {
  ContinueWatchingItemFieldsFragmentDoc,
  WatchStateChangedDocument,
} from '../graphql/generated/graphql'
import possibleTypes from '../graphql/generated/possibleTypes.json'
import { watchingMovie, watchingEpisode, watchingChange } from '../test/continueWatchingFixtures'

describe('Continue Watching payload selection', () => {
  it.each([
    ['Movie', watchingMovie],
    ['Episode', watchingEpisode],
  ] as const)('shouldPopulateTheHomeCardFromAnUncached%sEvent', (_kind, make) => {
    const cache = new InMemoryCache({ possibleTypes: possibleTypes.possibleTypes })
    const item = make({ id: 'new-item', orderKey: '10' })
    cache.writeQuery({
      query: WatchStateChangedDocument,
      data: {
        watchStateChanged: { items: [item], continueWatching: [watchingChange(item, '10')] },
      },
    })
    const card = cache.readFragment({
      id: cache.identify(item),
      fragment: ContinueWatchingItemFieldsFragmentDoc,
      fragmentName: 'ContinueWatchingItemFields',
    })
    expect(card).toMatchObject({ id: 'new-item', files: [{ id: 'file-new-item' }] })
  })
})
