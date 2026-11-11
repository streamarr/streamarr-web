import type { ApolloClient, DocumentNode } from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import { useState } from 'react'
import { isReading } from '../graphql/readAgain'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { UPDATE_FAILED_MESSAGE } from './shareText'

/**
 * A change to one row that waits for the admin's confirmation. Once sent, the list reads again
 * whatever the answer, because a refused row may have changed elsewhere; a refusal keeps the
 * confirmation open with the server's words.
 */
export function useConfirmedChange<Row>({
  send,
  listsToReadAgain,
  onDone,
}: {
  send: (row: Row) => Promise<readonly UserErrorLike[]>
  /** The queries of the lists that the change can alter. */
  listsToReadAgain: DocumentNode[]
  onDone: (row: Row) => void
}) {
  const client = useApolloClient()
  const [pending, setPending] = useState<Row | null>(null)
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  async function confirm(row: Row) {
    setRefusal(null)
    setSending(true)
    try {
      const errors = await send(row)
      if (errors.length > 0) setRefusal(errors.map(userErrorMessage).join(' '))
      await readListsAgain(client, listsToReadAgain)
      if (errors.length > 0) return
      setPending(null)
      onDone(row)
    } catch (error) {
      setRefusal(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
    } finally {
      setSending(false)
    }
  }

  return {
    pending,
    sending,
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
    [...client.getObservableQueries(lists)].map(async (query) => {
      const refetch = () => query.refetch().catch(() => undefined)
      if (isReading(query)) await refetch()
      await refetch()
    }),
  )
}
