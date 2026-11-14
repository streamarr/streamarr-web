import { useApolloClient, useMutation } from '@apollo/client/react'
import { useCallback, useRef } from 'react'
import {
  MarkNotificationsReadDocument,
  type NotificationFieldsFragment,
} from '../graphql/generated/graphql'
import { boundToCurrentIdentity } from '../graphql/client'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage } from '../graphql/userErrors'

type Shown = Pick<NotificationFieldsFragment, '__typename' | 'id' | 'unread'>

const MAXIMUM_IDS_PER_MARK = 100

/**
 * Marks the supplied unread Notifications when the reader explicitly chooses to read them.
 * Marks finish in request order so an earlier failure cannot follow a later success.
 * Every batch belongs to the identity that requested it, including those waiting to be sent.
 */
export function useMarkShownRead(markSent: () => (count: number) => void) {
  const client = useApolloClient()
  const [markShown] = useMutation(MarkNotificationsReadDocument)

  const queue = useRef<Promise<unknown>>(Promise.resolve())

  return useCallback(
    (notifications: readonly Shown[]): Promise<string | null> => {
      const identity = boundToCurrentIdentity(client)
      const markOnce = (marked: readonly Shown[]): Promise<string | null> => {
        const answered = markSent()
        return markShown({
          context: identity,
          variables: { input: { notificationIds: marked.map(({ id }) => id) } },
          update: (cache, { data }) => {
            if (data?.markNotificationsRead?.userErrors.length !== 0) return
            for (const notification of marked) {
              cache.modify({ id: cache.identify(notification), fields: { unread: () => false } })
            }
          },
        })
          .then(({ data }) => {
            const count = data?.markNotificationsRead?.unreadNotificationCount
            if (typeof count === 'number') answered(count)
            const refusal = data?.markNotificationsRead?.userErrors[0]
            return refusal ? userErrorMessage(refusal) : null
          })
          .catch((error: unknown) =>
            requestFailureMessage(error, "Couldn't mark notifications as read."),
          )
      }
      const unread = notifications.filter((notification) => notification.unread)
      const marks: Promise<string | null>[] = []
      for (let start = 0; start < unread.length; start += MAXIMUM_IDS_PER_MARK) {
        const marked = unread.slice(start, start + MAXIMUM_IDS_PER_MARK)
        const mark = queue.current.then(() => markOnce(marked))
        queue.current = mark
        marks.push(mark)
      }
      return Promise.all(marks).then((failures) => failures.find((failure) => failure) ?? null)
    },
    [client, markShown, markSent],
  )
}
