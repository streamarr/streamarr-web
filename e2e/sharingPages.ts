import type { APIRequestContext, Page, Route } from '@playwright/test'
import { STUB_URL } from './ports'

// The sharing pages as an admin of Smith Family sees them, whose own Profile is Alex. The stub
// answers Me; each page's lists come from `answers`, by operation name.

const DAY = 24 * 60 * 60 * 1000
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString()

type Data = Record<string, unknown>
type Answer = Data | ((variables: Data) => Data)

export const SHARE_CODE = 'BCDF-GHJK'

function sharedProfile(id: string, name: string, overrides: object = {}) {
  return {
    __typename: 'ProfileSummary',
    id,
    name,
    picture: null,
    kind: 'ADULT',
    personalProfile: false,
    restricted: false,
    ...overrides,
  }
}

function connection(typename: string, nodes: object[]) {
  return { __typename: typename, edges: nodes.map((node) => ({ __typename: 'Edge', node })) }
}

function offer(id: string, name: string, offeredBy: string, overrides: object = {}) {
  return {
    __typename: 'ProfileShare',
    id,
    profileId: `profile-${id}`,
    householdId: 'household-1',
    status: 'PENDING',
    expiresAt: inDays(7),
    profile: sharedProfile(`profile-${id}`, name),
    offeredByDisplayName: offeredBy,
    visitor: true,
    ...overrides,
  }
}

export const THREE_OFFERS = {
  householdShares: connection('ProfileShareConnection', [
    offer('mara', 'Mara', 'Sam', {
      profile: sharedProfile('profile-mara', 'Mara', { personalProfile: true }),
    }),
    offer('leo', 'Leo', 'Mara', {
      expiresAt: inDays(3),
      profile: sharedProfile('profile-leo', 'Leo', { kind: 'CHILD', restricted: true }),
    }),
    offer('alex', 'Alex', 'Leo', { expiresAt: inDays(1) }),
  ]),
}

function shareCode(id: string, issuedBy: string | null, daysLeft: number) {
  return {
    __typename: 'ShareCode',
    id,
    householdId: 'household-1',
    status: 'LIVE',
    issuedAt: new Date(Date.now() - (7 - daysLeft) * DAY).toISOString(),
    expiresAt: inDays(daysLeft),
    issuedByDisplayName: issuedBy,
  }
}

export const NO_CODES = { householdShareCodes: connection('ShareCodeConnection', []) }

export const THREE_CODES = {
  householdShareCodes: connection('ShareCodeConnection', [
    shareCode('code-1', 'Sam', 7),
    shareCode('code-2', 'Mara', 4),
    shareCode('code-3', null, 1),
  ]),
}

export const ISSUED = {
  issueShareCode: {
    __typename: 'IssueShareCodePayload',
    issued: {
      __typename: 'IssuedShareCode',
      code: SHARE_CODE,
      shareCode: shareCode('code-new', 'Sam', 7),
    },
    userErrors: [],
  },
}

function visitorShare(id: string, name: string, offeredBy: string, overrides: object = {}) {
  return {
    __typename: 'ProfileShare',
    id,
    profileId: `profile-${id}`,
    householdId: 'household-1',
    status: 'ACTIVE',
    requiredByAccountMembership: false,
    profile: sharedProfile(`profile-${id}`, name),
    offeredByDisplayName: offeredBy,
    visitor: true,
    ...overrides,
  }
}

export const SHARED_WITH_US = {
  householdShares: connection('ProfileShareConnection', [
    visitorShare('mara', 'Mara', 'Sam', {
      profile: sharedProfile('profile-mara', 'Mara', { personalProfile: true }),
    }),
    visitorShare('leo', 'Leo', 'Mara', {
      profile: sharedProfile('profile-leo', 'Leo', { kind: 'CHILD', restricted: true }),
    }),
  ]),
}

export const VISITOR_TVS = {
  householdDevices: connection('DeviceRegistrationConnection', [
    {
      __typename: 'DeviceRegistrationDetails',
      id: 'tv-1',
      householdId: 'household-1',
      displayName: 'Living room TV',
      authorizingAccountDisplayName: 'Mara',
      status: 'ACTIVE',
      pairedAt: new Date(Date.now() - 2 * DAY).toISOString(),
    },
  ]),
}

function profileShare(id: string, household: string, status: string, overrides: object = {}) {
  return {
    __typename: 'ProfileShare',
    id,
    householdId: `household-${id}`,
    status,
    requiredByAccountMembership: false,
    expiresAt: status === 'PENDING' ? inDays(6) : null,
    endedAt: null,
    invalidationReason: null,
    household: { __typename: 'HouseholdSummary', id: `household-${id}`, name: household },
    ...overrides,
  }
}

/** Where Alex's Profile is shared: with Cabin, and offered to Lake House. */
export function alexsShares(variables: Record<string, unknown>) {
  const statuses = [variables.statuses].flat()
  const shares = [
    profileShare('cabin', 'Cabin', 'ACTIVE'),
    profileShare('lake-house', 'Lake House', 'PENDING'),
  ].filter((share) => statuses.includes(share.status))
  return { profileShares: connection('ProfileShareConnection', shares) }
}

export const CODE_FOUND = {
  lookUpShareCode: { __typename: 'LookUpShareCodePayload', householdName: 'Cabin', userErrors: [] },
}

export const CODE_REFUSED = {
  lookUpShareCode: {
    __typename: 'LookUpShareCodePayload',
    householdName: null,
    userErrors: [
      {
        __typename: 'ShareCodeRefusedError',
        message: 'This share code does not work. Ask the Household for a new one.',
      },
    ],
  },
}

export const BOTH_WARNINGS = {
  profileSharePreview: {
    __typename: 'ProfileSharePreview',
    wouldLock: true,
    nameConflict: true,
  },
}

/** Signs in to the stub and answers the sharing pages' questions from `answers`. */
export async function serveSharingPages(
  page: Page,
  request: APIRequestContext,
  answers: Record<string, Answer>,
) {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const { operationName, variables } = route.request().postDataJSON() as {
      operationName?: string
      variables?: Record<string, unknown>
    }
    if (operationName === 'Me') return route.fulfill({ json: await smithFamily(route) })
    const answer = operationName === undefined ? undefined : answers[operationName]
    if (answer === undefined) return route.fallback()
    const data = typeof answer === 'function' ? answer(variables ?? {}) : answer
    return route.fulfill({ json: { data } })
  })
}

// The stub's Account, renamed: an admin of Smith Family whose own Profile is Alex.
async function smithFamily(route: Route) {
  const answer = (await (await route.fetch()).json()) as { data: { me: Record<string, never> } }
  const text = JSON.stringify(answer)
    .replaceAll('Dev Household', 'Smith Family')
    .replaceAll('Dev Admin', 'Sam')
    .replaceAll('"Dev"', '"Alex"')
  return JSON.parse(text) as object
}
