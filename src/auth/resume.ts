// Only a known internal destination may be resumed after signing in. Echoing an arbitrary
// redirect target back into a navigation is how open-redirect bugs get in.

export const RESUMABLE = '/link'

export interface ResumeSearch {
  redirect?: typeof RESUMABLE
  code?: string
}

/** What to hand /login so it can send a bounced visitor back — nothing, from anywhere else. */
export function resumeSearchFor(pathname: string): ResumeSearch {
  return pathname === RESUMABLE ? { redirect: RESUMABLE } : {}
}
