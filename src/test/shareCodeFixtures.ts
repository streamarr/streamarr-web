import { graphql, HttpResponse } from 'msw'
import { server } from './server'

/** A share code as an admin hands it out. */
export const SHARE_CODE = 'BCDF-GHJK'

/** The same code as the client sends it: the eight letters alone. */
export const SENT_SHARE_CODE = 'BCDFGHJK'

/** The answer to looking a working code up: the name of its Household. */
export function shareCodeLookUpFixture({
  householdName = 'Cabin',
}: { householdName?: string } = {}) {
  return {
    lookUpShareCode: { __typename: 'LookUpShareCodePayload', householdName, userErrors: [] },
  }
}

/** The server's words for a code that does not work, whichever way it stopped working. */
export const SHARE_CODE_REFUSED = 'This share code does not work. Ask the Household for a new one.'

/** The answer to looking up a code that does not work, which names no Household. */
export function refusedShareCodeFixture() {
  return {
    lookUpShareCode: {
      __typename: 'LookUpShareCodePayload',
      householdName: null,
      userErrors: [{ __typename: 'ShareCodeRefusedError', message: SHARE_CODE_REFUSED }],
    },
  }
}

/** What offering the Profile with the code would do there. */
export function sharePreviewFixture(
  overrides: { wouldLock?: boolean; nameConflict?: boolean } = {},
) {
  return {
    profileSharePreview: {
      __typename: 'ProfileSharePreview',
      wouldLock: false,
      nameConflict: false,
      ...overrides,
    },
  }
}

/**
 * Serves the lookup and the preview of a share code, each answering `data`, and records the
 * variables of every request so a test can say how often the server was asked.
 */
export function serveShareCodeQuestions({
  lookUp = shareCodeLookUpFixture(),
  preview = sharePreviewFixture(),
}: {
  lookUp?: object
  preview?: object
} = {}) {
  const asked = { lookUps: [] as unknown[], previews: [] as unknown[] }
  server.use(
    graphql.mutation('LookUpShareCode', ({ variables }) => {
      asked.lookUps.push(variables)
      return HttpResponse.json({ data: lookUp })
    }),
    graphql.query('ProfileSharePreview', ({ variables }) => {
      asked.previews.push(variables)
      return HttpResponse.json({ data: preview })
    }),
  )
  return asked
}
