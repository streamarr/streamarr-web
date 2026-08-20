// One full answer to the Me query's selection set (ADR 0024 shape): every test and stub that
// serves `me` builds from here, so a schema change breaks one file loudly instead of five
// quietly. Overrides go deep enough for the common cases; anything fancier builds its own node.

export const HOUSEHOLD_ID = '22222222-2222-2222-2222-222222222222'
export const PROFILE_ID = '33333333-3333-3333-3333-333333333333'

export interface MeFixtureProfile {
  __typename: 'SelectableProfile'
  id: string
  name: string
  picture: string | null
  kind: 'ADULT' | 'KID'
  personal: boolean
  pinConfigured: boolean
  locked: boolean
  selected: boolean
}

export function profileFixture(overrides: Partial<MeFixtureProfile> = {}): MeFixtureProfile {
  return {
    __typename: 'SelectableProfile',
    id: PROFILE_ID,
    name: 'Alex',
    picture: null,
    kind: 'ADULT',
    personal: true,
    pinConfigured: false,
    locked: false,
    selected: false,
    ...overrides,
  }
}

export function meFixture(
  overrides: {
    profiles?: MeFixtureProfile[]
    usableHouseholds?: { id: string; name: string; membership: boolean }[]
    contextHouseholdId?: string
    contextHouseholdName?: string
    scope?: string
    deviceBound?: boolean
  } = {},
) {
  const households = overrides.usableHouseholds ?? [
    { id: HOUSEHOLD_ID, name: 'Smith Family', membership: true },
  ]
  const profiles = overrides.profiles ?? [profileFixture()]
  return {
    __typename: 'Me' as const,
    accountId: '11111111-1111-1111-1111-111111111111',
    email: 'owner@example.com',
    displayName: 'Owner',
    serverAdmin: false,
    scope: overrides.scope ?? 'account',
    deviceBound: overrides.deviceBound ?? false,
    householdRole: 'ADMIN',
    household: { __typename: 'HouseholdSummary' as const, id: HOUSEHOLD_ID, name: 'Smith Family' },
    contextHousehold: {
      __typename: 'HouseholdSummary' as const,
      id: overrides.contextHouseholdId ?? HOUSEHOLD_ID,
      name: overrides.contextHouseholdName ?? 'Smith Family',
    },
    usableHouseholds: {
      __typename: 'UsableHouseholdConnection' as const,
      edges: households.map((usable) => ({
        __typename: 'UsableHouseholdEdge' as const,
        node: {
          __typename: 'UsableHousehold' as const,
          membership: usable.membership,
          household: {
            __typename: 'HouseholdSummary' as const,
            id: usable.id,
            name: usable.name,
          },
        },
      })),
    },
    selectableProfiles: {
      __typename: 'SelectableProfileConnection' as const,
      edges: profiles.map((profile) => ({
        __typename: 'SelectableProfileEdge' as const,
        node: profile,
      })),
    },
    selectedProfile: profiles.find((profile) => profile.selected) ?? null,
  }
}
