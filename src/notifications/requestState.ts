import type {
  NotificationFieldsFragment,
  ProfileShareStatus,
  RequestResolution,
} from '../graphql/generated/graphql'

type OfferRequest = Extract<
  NotificationFieldsFragment,
  { __typename: 'ProfileShareOfferedNotification' }
>

/**
 * Where a Request stands for its row: it waits, so the row links to where it is decided, or it is
 * over, and the row says how it ended. `ending` is null for an ending the server added after this
 * client, which the row leaves unsaid rather than guess.
 */
export type RequestState = { at: 'waiting' } | { at: 'over'; ending: string | null }

/** Whether `notification` is a Request of an offer, the one kind of Request this client opens. */
export function isOfferRequest(
  notification: NotificationFieldsFragment,
): notification is OfferRequest {
  return notification.__typename === 'ProfileShareOfferedNotification'
}

/**
 * Where the Request of an offer stands at `now`. An offer past its expiry reads as expired from
 * then on, as the server reads it, before the server's change says so.
 */
export function offerRequestState(request: OfferRequest, now: Date): RequestState {
  const resolution = request.resolution ?? (hasExpired(request.expiresAt, now) ? 'EXPIRED' : null)
  if (resolution === null) return { at: 'waiting' }
  return { at: 'over', ending: endingOf(resolution, request.share.status) }
}

/** The moment a waiting Request of an offer expires, when it has one. */
export function expiryOfWaiting(notification: NotificationFieldsFragment): string | null {
  if (!isOfferRequest(notification) || notification.resolution !== null) return null
  return notification.expiresAt
}

function hasExpired(expiresAt: string | null, now: Date): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= now.getTime()
}

function endingOf(resolution: RequestResolution, status: ProfileShareStatus): string | null {
  switch (resolution) {
    case 'DECIDED':
      return decisionOf(status)
    case 'WITHDRAWN':
      return 'Withdrawn'
    case 'EXPIRED':
      return 'Expired'
    default:
      return null
  }
}

// A decided offer was accepted when its share went on to be active, and later perhaps ended.
function decisionOf(status: ProfileShareStatus): string | null {
  if (status === 'ACTIVE' || status === 'ENDED') return 'Accepted'
  if (status === 'REJECTED') return 'Declined'
  return null
}
