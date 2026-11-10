export const UPDATE_FAILED_MESSAGE = "Couldn't update sharing."

/** The start of an id, where the server gives no name for what it identifies. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}
