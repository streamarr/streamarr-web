import { describe, expect, it } from 'vitest'
import {
  keepsInHouseholdShares,
  keepsInProfileShares,
  createShareListUpdater,
  type HouseholdShareList,
  type LiveShare,
} from './shareLists'
import { HOUSEHOLD_ID, PROFILE_ID } from '../test/meFixture'
import { HIDDEN_ONCE_OVER, liveShare } from '../test/shareChangeFixtures'

const NOW = new Date()
// A minute ago, so that an offer that expired then is no longer waiting for a decision.
const A_MINUTE_AGO = new Date(NOW.getTime() - 60_000).toISOString()
const HOUSEHOLD = HOUSEHOLD_ID
const PROFILE = PROFILE_ID
const share = liveShare
const OVER = HIDDEN_ONCE_OVER

const offers = (overrides: Partial<HouseholdShareList> = {}): HouseholdShareList => ({
  householdId: HOUSEHOLD,
  statuses: ['PENDING'],
  serverAdmin: false,
  ...overrides,
})
const visitors = (overrides: Partial<HouseholdShareList> = {}): HouseholdShareList => ({
  householdId: HOUSEHOLD,
  statuses: ['ACTIVE'],
  visitorsOnly: true,
  serverAdmin: false,
  ...overrides,
})

describe('keepsInHouseholdShares', () => {
  it.each<[string, LiveShare, HouseholdShareList, boolean]>([
    ['an offer waiting for a decision', share(), offers(), true],
    ['an offer past its expiry', share({ expiresAt: A_MINUTE_AGO }), offers(), false],
    ['an offer accepted', share({ status: 'ACTIVE' }), offers(), false],
    ['an offer declined', share({ status: 'REJECTED', ...OVER }), offers(), false],
    ['an offer to another Household', share({ householdId: 'cabin' }), offers(), false],
    ['a visitor shared here', share({ status: 'ACTIVE' }), visitors(), true],
    ["the Household's own Profile", share({ status: 'ACTIVE', visitor: false }), visitors(), false],
    ['a visitor whose share ended', share({ status: 'ENDED', ...OVER }), visitors(), false],
    [
      'a declined offer that a ServerAdmin lists',
      share({ status: 'REJECTED' }),
      offers({ statuses: ['REJECTED'], serverAdmin: true }),
      true,
    ],
    [
      'a declined offer that anyone else lists',
      share({ status: 'REJECTED' }),
      offers({ statuses: ['REJECTED'] }),
      false,
    ],
    [
      'an offer past its expiry that a ServerAdmin lists as expired',
      share({ expiresAt: A_MINUTE_AGO }),
      offers({ statuses: ['EXPIRED'], serverAdmin: true }),
      true,
    ],
    [
      'an ended share in a list of every status',
      share({ status: 'ENDED' }),
      offers({ statuses: [] }),
      false,
    ],
  ])('shouldKeepOnlyWhatTheListHoldsWhenItIs(%s)', (_, change, list, kept) => {
    expect(keepsInHouseholdShares(change, list, NOW)).toBe(kept)
  })
})

describe('keepsInProfileShares', () => {
  it.each<[string, LiveShare, boolean]>([
    ['an offer waiting for a decision', share(), true],
    ['a share that ended', share({ status: 'ENDED' }), true],
    ['a share of another Profile', share({ profileId: 'robin' }), false],
  ])('shouldKeepEveryShareOfTheProfileWhenItIs(%s)', (_, change, kept) => {
    expect(keepsInProfileShares(change, { profileId: PROFILE }, NOW)).toBe(kept)
  })

  it('shouldKeepOnlyTheListsStatusesWhenItNamesSome', () => {
    const list = { profileId: PROFILE, statuses: ['PENDING', 'ACTIVE'] as const }

    expect(keepsInProfileShares(share({ status: 'ACTIVE' }), list, NOW)).toBe(true)
    expect(keepsInProfileShares(share({ status: 'CANCELED' }), list, NOW)).toBe(false)
  })
})

describe('createShareListUpdater', () => {
  const alex = { cursor: 'alex', orderKey: 'm', node: share({ id: 'share-alex' }) }
  const robin = {
    cursor: 'robin',
    orderKey: 'z',
    node: share({ id: 'share-robin', profileId: 'robin' }),
  }
  const middle = { cursor: 'middle', orderKey: 't', node: share({ id: 'share-middle' }) }
  function page(edges: (typeof alex)[], hasNextPage = false) {
    return { edges, pageInfo: { hasNextPage, endCursor: edges.at(-1)?.cursor ?? null } }
  }

  it('shouldPlaceAnOlderShareAfterTheLoadedShareWhenTheServerOrdersItLater', () => {
    const apply = createShareListUpdater()

    const edges = apply(page([alex]), { shareId: robin.node.id, edge: robin })

    expect(edges.map((edge) => edge.node.id)).toEqual(['share-alex', 'share-robin'])
    expect(edges[1]).toEqual(robin)
  })

  it('shouldReplaceAListedShareAtItsServerPositionWhenItsOrderChanges', () => {
    const apply = createShareListUpdater()
    const changed = { ...robin, orderKey: 'a', node: { ...robin.node, status: 'ACTIVE' as const } }

    const edges = apply(page([alex, robin]), { shareId: robin.node.id, edge: changed })

    expect(edges).toEqual([changed, alex])
  })

  it('shouldRemoveTheShareWhenTheServerSaysItIsInNoList', () => {
    const apply = createShareListUpdater()

    const edges = apply(page([alex, robin]), { shareId: alex.node.id, edge: null })

    expect(edges).toEqual([robin])
  })

  it('shouldKeepTheListWhenTheChangeConcernsNoListedShare', () => {
    const apply = createShareListUpdater()

    const edges = apply(page([alex]), { shareId: robin.node.id, edge: null })

    expect(edges).toEqual([alex])
  })

  it('shouldWaitForTheNextPageWhenAChangedShareIsBeyondTheLoadedBoundary', () => {
    const apply = createShareListUpdater()

    const edges = apply(page([alex], true), { shareId: robin.node.id, edge: robin })

    expect(edges).toEqual([alex])
  })

  it('shouldKeepTheLoadedBoundaryWhenALiveChangeRemovedItsLastRow', () => {
    const apply = createShareListUpdater()
    const listed = page([alex, robin], true)
    const withoutLast = {
      ...listed,
      edges: apply(listed, { shareId: robin.node.id, edge: null }),
    }

    const edges = apply(withoutLast, { shareId: middle.node.id, edge: middle })

    expect(edges).toEqual([alex, middle])
  })

  it('shouldRetainEachPageBoundaryWhenChangesReplayAgainstAnotherPage', () => {
    const apply = createShareListUpdater()
    const listed = page([alex, robin], true)
    const withoutLast = { ...listed, edges: apply(listed, { shareId: robin.node.id, edge: null }) }
    apply(page([middle]), { shareId: robin.node.id, edge: null })

    const edges = apply(withoutLast, { shareId: middle.node.id, edge: middle })

    expect(edges).toEqual([alex, middle])
  })

  it('shouldExpandTheBoundaryWhenTheNextPageLoads', () => {
    const apply = createShareListUpdater()
    expect(apply(page([alex], true), { shareId: middle.node.id, edge: middle })).toEqual([alex])

    const edges = apply(page([alex, robin], true), { shareId: middle.node.id, edge: middle })

    expect(edges).toEqual([alex, middle, robin])
  })

  it('shouldAllowEveryServerPositionWhenTheFinalPageHasLoaded', () => {
    const apply = createShareListUpdater()
    expect(apply(page([alex], true), { shareId: robin.node.id, edge: robin })).toEqual([alex])

    const edges = apply(page([alex]), { shareId: robin.node.id, edge: robin })

    expect(edges).toEqual([alex, robin])
  })

  it('shouldWaitForAPageBoundaryWhenNoLoadedRowSuppliesOne', () => {
    const apply = createShareListUpdater()

    const edges = apply(page([], true), { shareId: robin.node.id, edge: robin })

    expect(edges).toEqual([])
  })
})
