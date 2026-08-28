import type { MeQuery } from '../graphql/generated/graphql'

// Every test and stub that serves `me` builds from here. The shape is derived from the generated
// query, so a schema rename fails typecheck instead of surfacing as a runtime cache warning.

export const HOUSEHOLD_ID = '22222222-2222-2222-2222-222222222222'
export const PROFILE_ID = '33333333-3333-3333-3333-333333333333'

type Me = MeQuery['me']
type Named<Typename extends string, Shape> = Shape & { __typename: Typename }

type HouseholdSummary = Named<'HouseholdSummary', Me['contextHousehold']>
type UsableHousehold = Named<
  'UsableHousehold',
  Me['usableHouseholds']['edges'][number]['node'] & { household: HouseholdSummary }
>
export type MeFixtureProfile = Named<
  'SelectableProfile',
  Me['selectableProfiles']['edges'][number]['node']
>

export type MeFixture = Named<
  'Me',
  Me & {
    household: HouseholdSummary
    contextHousehold: HouseholdSummary
    usableHouseholds: Named<
      'UsableHouseholdConnection',
      { edges: Named<'UsableHouseholdEdge', { node: UsableHousehold }>[] }
    >
    selectableProfiles: Named<
      'SelectableProfileConnection',
      { edges: Named<'SelectableProfileEdge', { node: MeFixtureProfile }>[] }
    >
    selectedProfile: MeFixtureProfile | null
  }
>

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
): MeFixture {
  const households = overrides.usableHouseholds ?? [
    { id: HOUSEHOLD_ID, name: 'Smith Family', membership: true },
  ]
  const profiles = overrides.profiles ?? [profileFixture()]
  return {
    __typename: 'Me',
    accountId: '11111111-1111-1111-1111-111111111111',
    email: 'owner@example.com',
    displayName: 'Owner',
    serverAdmin: false,
    scope: overrides.scope ?? 'account',
    deviceBound: overrides.deviceBound ?? false,
    householdRole: 'ADMIN',
    household: { __typename: 'HouseholdSummary', id: HOUSEHOLD_ID, name: 'Smith Family' },
    contextHousehold: {
      __typename: 'HouseholdSummary',
      id: overrides.contextHouseholdId ?? HOUSEHOLD_ID,
      name: overrides.contextHouseholdName ?? 'Smith Family',
    },
    usableHouseholds: {
      __typename: 'UsableHouseholdConnection',
      edges: households.map((usable) => ({
        __typename: 'UsableHouseholdEdge',
        node: {
          __typename: 'UsableHousehold',
          membership: usable.membership,
          household: {
            __typename: 'HouseholdSummary',
            id: usable.id,
            name: usable.name,
          },
        },
      })),
    },
    selectableProfiles: {
      __typename: 'SelectableProfileConnection',
      edges: profiles.map((profile) => ({
        __typename: 'SelectableProfileEdge',
        node: profile,
      })),
    },
    selectedProfile: profiles.find((profile) => profile.selected) ?? null,
  }
}
