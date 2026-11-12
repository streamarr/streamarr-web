import { useMutation } from '@apollo/client/react'
import { useCallback, useRef } from 'react'
import { MarkNotificationsReadDocument } from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage } from '../graphql/userErrors'

/** A Notification as the page shows it, by its id. */
interface Shown {
  id: string
  unread: boolean
}

/** The most ids the server takes in one mark. */
const MOST_IDS_IN_A_MARK = 100

/**
 * Returns the function that marks read, by their ids, the unread ones among the Notifications the
 * page shows it: the one the person opens, or every row when the person marks them all. Opening
 * the list marks nothing. The ids go in one mark, or in marks of at most 100 when there are more,
 * and the marks go one after another, so that each answer's unread count is newer than the one
 * before it. `markSent` is called as each mark goes out, and its function takes the count the mark
 * answers (`useUnreadNotificationCount`). A mark that fails leaves its Notifications unread, and
 * the next mark goes out all the same. The function settles once its marks have, with the words
 * of the first that failed, or null when none did.
 *
 * The server tells every socket, this page's too, that each of them is read, and the rows follow
 * that change.
 */
export function useMarkShownRead(markSent: () => (count: number) => void) {
  const [markShown] = useMutation(MarkNotificationsReadDocument)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  return useCallback(
    (notifications: readonly Shown[]): Promise<string | null> => {
      const markOnce = (notificationIds: string[]): Promise<string | null> => {
        const answered = markSent()
        return markShown({ variables: { input: { notificationIds } } })
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
      for (let start = 0; start < unread.length; start += MOST_IDS_IN_A_MARK) {
        const notificationIds = unread.slice(start, start + MOST_IDS_IN_A_MARK).map(({ id }) => id)
        const mark = queue.current.then(() => markOnce(notificationIds))
        queue.current = mark
        marks.push(mark)
      }
      return Promise.all(marks).then((failures) => failures.find((failure) => failure) ?? null)
    },
    [markShown, markSent],
  )
}
