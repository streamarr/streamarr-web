const CODE_PARAMETER = 'code'
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

function codeInLink(text: string): string | null {
  const trimmed = text.trim()
  if (!URL.canParse(trimmed)) return null
  return new URL(trimmed).searchParams.get(CODE_PARAMETER)
}
