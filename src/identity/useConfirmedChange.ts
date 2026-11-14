import type { ApolloClient, DocumentNode } from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import { useEffect, useEffectEvent, useState } from 'react'
import { refetchAfterReadsInFlight } from '../graphql/readAgain'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { UPDATE_FAILED_MESSAGE } from './shareText'

/**
 * A change to one row that waits for the admin's confirmation. The confirmation closes as soon as
 * the server takes the change. A refusal keeps the confirmation open with the server's words.
 * Either way the list then reads again, because a refused row may have changed elsewhere, and the
 * admin may leave the confirmation meanwhile. `changing` stays true until the server answers that
 * read, and the page keeps every confirmation of the list from confirming until then. Otherwise a
 * read sent before one change could answer after a second change and bring back the second row. A
 * confirmation whose row a change made elsewhere takes out of the list closes, since confirming it
 * could only fail, and `onGone` says why. A row that leaves while its own request is on its way is
 * that request's to report.
 */
export function useConfirmedChange<Row extends { id: string }>({
  send,
  listsToReadAgain,
  onDone,
  listed,
  onGone,
}: {
  send: (row: Row) => Promise<readonly UserErrorLike[]>
  /** The queries of the lists that the change can alter. */
  listsToReadAgain: DocumentNode[]
  onDone: (row: Row) => void
  /** The rows that the page lists now, or undefined while it has no list to show. */
  listed: readonly { id: string }[] | undefined
  onGone: (row: Row) => void
}) {
  const client = useApolloClient()
  const [pending, setPending] = useState<Row | null>(null)
  const [sending, setSending] = useState(false)
  const [changing, setChanging] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  /** The last row whose confirmation closed because the row left, until the page says so. */
  const [left, setLeft] = useState<{ row: Row } | null>(null)
  if (
    pending !== null &&
    !sending &&
    refusal === null &&
    listed !== undefined &&
    !listed.some((row) => row.id === pending.id)
  ) {
    setLeft({ row: pending })
    setPending(null)
  }
  const sayWhy = useEffectEvent((row: Row) => onGone(row))

  useEffect(() => {
    if (left) sayWhy(left.row)
  }, [left])

  async function confirm(row: Row) {
    setRefusal(null)
    setSending(true)
    setChanging(true)
    try {
      const answered = await sendAndSettle(row)
      setSending(false)
      if (answered) await readListsAgain(client, listsToReadAgain)
    } finally {
      setChanging(false)
    }
  }

  /** Settles the confirmation by the server's answer; false when the request got no answer. */
  async function sendAndSettle(row: Row): Promise<boolean> {
    try {
      settle(row, await send(row))
      return true
    } catch (error) {
      setRefusal(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
      return false
    }
  }

  function settle(row: Row, errors: readonly UserErrorLike[]) {
    if (errors.length > 0) {
      setRefusal(errors.map(userErrorMessage).join(' '))
      return
    }
    setPending(null)
    onDone(row)
  }

  return {
    pending,
    /** Whether the confirmed change still waits for the server's answer. */
    sending,
    /** Whether the confirmed change, or the read of the list that follows the change, still waits. */
    changing,
    refusal,
    ask: (row: Row) => {
      setRefusal(null)
      setPending(row)
    },
    close: () => {
      setPending(null)
      setRefusal(null)
    },
    confirmPending: () => {
      if (pending) void confirm(pending)
    },
  }
}

// A read sent before the change can answer as if the change never happened, and a refetch now
// would join that read. The app reads every active query again when the page comes back into view
// or online. So a read already on its way settles first, and a fresh read follows. A failed read
// keeps the list on screen, and the list's own query reports the failure.
function readListsAgain(client: ApolloClient, lists: DocumentNode[]): Promise<unknown> {
  return Promise.all(
    [...client.getObservableQueries(lists)].map((query) =>
      refetchAfterReadsInFlight(query).catch(() => undefined),
    ),
  )
}
