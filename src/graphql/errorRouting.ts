// Where an auth error should send the user. EXPIRED_TOKEN is deliberately absent because it is
// useful only to the renewal worker. INVALID_TOKEN remains a login fallback if it escapes that
// worker (for example, before a newly installed worker controls the page).

export interface AuthErrorContext {
  networkStatus?: number
  networkCode?: string | null
  graphqlCodes?: string[]
}

const LOGIN_CODES = new Set(['AUTHENTICATION_REQUIRED', 'INVALID_TOKEN'])
const SELECT_CODES = new Set(['PROFILE_REQUIRED', 'HOUSEHOLD_REQUIRED'])

export function decideAuthRoute(ctx: AuthErrorContext): '/login' | '/select' | null {
  if (ctx.graphqlCodes?.some((code) => SELECT_CODES.has(code))) {
    return '/select'
  }
  if (ctx.networkStatus === 401 && ctx.networkCode && LOGIN_CODES.has(ctx.networkCode)) {
    return '/login'
  }
  return null
}

/**
 * Reads the routing signals out of an Apollo v4 error by shape: a CombinedGraphQLErrors carries
 * an `errors` array with per-error `extensions.code`; a network error (ServerError) carries
 * `statusCode` and a JSON `bodyText`. Defensive so it never throws inside the error link.
 */
export function extractAuthContext(error: unknown): AuthErrorContext {
  if (typeof error !== 'object' || error === null) {
    return {}
  }
  const record = error as Record<string, unknown>

  if (Array.isArray(record.errors)) {
    const graphqlCodes = record.errors
      .map((entry) => (entry as { extensions?: { code?: unknown } })?.extensions?.code)
      .filter((code): code is string => typeof code === 'string')
    return { graphqlCodes }
  }

  if (typeof record.statusCode === 'number') {
    return { networkStatus: record.statusCode, networkCode: parseBodyCode(record.bodyText) }
  }

  return {}
}

function parseBodyCode(bodyText: unknown): string | null {
  if (typeof bodyText !== 'string') {
    return null
  }
  try {
    const body = JSON.parse(bodyText) as { code?: unknown }
    return typeof body.code === 'string' ? body.code : null
  } catch {
    return null
  }
}
