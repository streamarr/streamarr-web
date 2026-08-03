// Only a known internal destination may be resumed after signing in. Echoing an arbitrary
// redirect target back into a navigation is how open-redirect bugs get in.

export const RESUMABLE = '/link'

export interface ResumeSearch {
  redirect?: typeof RESUMABLE
  code?: string
}
