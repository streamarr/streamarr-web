export interface AuthErrorContext {
  networkStatus?: number
  networkCode?: string | null
  graphqlCodes?: string[]
}

// EXPIRED_TOKEN is deliberately absent: only the renewal worker acts on it. INVALID_TOKEN stays a
// login fallback for when it escapes that worker.
const LOGIN_CODES = new Set(['AUTHENTICATION_REQUIRED', 'INVALID_TOKEN'])
const SELECT_CODES = new Set(['PROFILE_REQUIRED', 'HOUSEHOLD_REQUIRED'])

export function decideAuthRoute(ctx: AuthErrorContext): '/login' | '/select-profile' | null {
  if (ctx.graphqlCodes?.some((code) => SELECT_CODES.has(code))) {
    return '/select-profile'
  }
  if (ctx.networkStatus === 401 && ctx.networkCode && LOGIN_CODES.has(ctx.networkCode)) {
    return '/login'
  }
  if (ctx.graphqlCodes?.some((code) => LOGIN_CODES.has(code))) {
    return '/login'
  }
  return null
}

/**
 * By shape: CombinedGraphQLErrors carries `errors[].extensions.code`; a ServerError carries
 * `statusCode` and a JSON `bodyText`. Never throws inside the error link.
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
