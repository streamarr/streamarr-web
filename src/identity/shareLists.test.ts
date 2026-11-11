import { describe, expect, it } from 'vitest'
import {
  keepsInHouseholdShares,
  keepsInProfileShares,
  withShareChange,
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

describe('withShareChange', () => {
  const alex = share({ id: 'share-alex' })
  const robin = share({ id: 'share-robin', profileId: 'robin' })
  const keepsAll = () => true

  it('shouldPutAShareTheListDidNotHoldFirstWhenItKeepsIt', () => {
    const edges = withShareChange([{ node: alex }], { shareId: robin.id, share: robin }, keepsAll)

    expect(edges.map((edge) => edge.node.id)).toEqual(['share-robin', 'share-alex'])
  })

  it('shouldReplaceAListedShareInItsPlaceWhenItChanges', () => {
    const accepted = share({ id: 'share-alex', status: 'ACTIVE' })

    const edges = withShareChange(
      [{ node: robin }, { node: alex }],
      { shareId: alex.id, share: accepted },
      keepsAll,
    )

    expect(edges.map((edge) => edge.node)).toEqual([robin, accepted])
  })

  it('shouldTakeOutAListedShareWhenTheListNoLongerKeepsIt', () => {
    const edges = withShareChange(
      [{ node: robin }, { node: alex }],
      { shareId: alex.id, share: share({ id: alex.id, status: 'ENDED', ...OVER }) },
      () => false,
    )

    expect(edges.map((edge) => edge.node.id)).toEqual(['share-robin'])
  })

  it('shouldTakeOutAListedShareWhenItNoLongerExists', () => {
    const edges = withShareChange(
      [{ node: robin }, { node: alex }],
      { shareId: alex.id, share: null },
      keepsAll,
    )

    expect(edges.map((edge) => edge.node.id)).toEqual(['share-robin'])
  })

  it('shouldLeaveTheListAsItWasWhenTheChangeIsNoneOfItsConcern', () => {
    const listed = [{ node: alex }]

    expect(withShareChange(listed, { shareId: robin.id, share: robin }, () => false)).toEqual(
      listed,
    )
  })
})
