import { useMutation } from '@apollo/client/react'
import { useCallback } from 'react'
import {
  MarkNotificationsReadDocument,
  type NotificationFieldsFragment,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage } from '../graphql/userErrors'

type Shown = Pick<NotificationFieldsFragment, '__typename' | 'id' | 'unread'>

const MAXIMUM_IDS_PER_MARK = 100

/** Marks the supplied unread Notifications when the reader explicitly chooses to read them. */
export function useMarkShownRead(onCount: (count: number) => void) {
  const [markShown] = useMutation(MarkNotificationsReadDocument)

  return useCallback(
    async (notifications: readonly Shown[]): Promise<string | null> => {
      const unread = notifications.filter((notification) => notification.unread)
      let failure: string | null = null
      for (let start = 0; start < unread.length; start += MAXIMUM_IDS_PER_MARK) {
        const marked = unread.slice(start, start + MAXIMUM_IDS_PER_MARK)
        try {
          const { data } = await markShown({
            variables: { input: { notificationIds: marked.map(({ id }) => id) } },
            update: (cache, { data }) => {
              if (data?.markNotificationsRead?.userErrors.length !== 0) return
              for (const notification of marked) {
                cache.modify({ id: cache.identify(notification), fields: { unread: () => false } })
              }
            },
          })
          const count = data?.markNotificationsRead?.unreadNotificationCount
          if (typeof count === 'number') onCount(count)
          const refusal = data?.markNotificationsRead?.userErrors[0]
          failure ??= refusal ? userErrorMessage(refusal) : null
        } catch (error: unknown) {
          failure ??= requestFailureMessage(error, "Couldn't mark notifications as read.")
        }
      }
      return failure
    },
    [markShown, onCount],
  )
}
