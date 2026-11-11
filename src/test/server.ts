import { graphql, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

/**
 * What the Profile menu's counts read on every page of an account session, answered with nothing
 * to count, so that a test about something else need not serve it. A test that cares serves its
 * own, and a test that answers every other read itself serves these again.
 */
export const menuCountReads = [
  graphql.query('UnreadNotificationCount', () =>
    HttpResponse.json({ data: { unreadNotificationCount: 0 } }),
  ),
]

export const server = setupServer(...menuCountReads)
