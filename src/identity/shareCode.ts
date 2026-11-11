import { CODE_PARAMETER, codeInFragment } from './fragmentCode'

const SHARING_PAGE = '/settings/profile/sharing'
const EIGHT_LETTERS = /^[A-Z]{8}$/

/**
 * The share code that `text` holds, as the eight letters the server takes, or null when the text
 * cannot be one. Case, spaces and the hyphen do not matter, and a pasted share code link gives
 * the code it carries.
 */
export function shareCodeIn(text: string): string | null {
  const letters = (codeInLink(text) ?? text).replaceAll(/[\s-]/g, '').toUpperCase()
  return EIGHT_LETTERS.test(letters) ? letters : null
}

/**
 * The link that opens the Sharing page with `code` filled in, on the client at `origin`. The code
 * rides in the fragment, which a browser never sends to a server, so it stays out of access logs.
 */
export function shareCodeLink(code: string, origin: string): string {
  const link = new URL(SHARING_PAGE, origin)
  link.hash = new URLSearchParams({ [CODE_PARAMETER]: code }).toString()
  return link.href
}

// A pasted link carries the code in its fragment, or in its query as an older link did.
function codeInLink(text: string): string | null {
  const trimmed = text.trim()
  if (!URL.canParse(trimmed)) return null
  const link = new URL(trimmed)
  return codeInFragment(link.hash) ?? link.searchParams.get(CODE_PARAMETER)
}
