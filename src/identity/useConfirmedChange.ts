import { useState } from 'react'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { UPDATE_FAILED_MESSAGE } from './shareText'

/**
 * A change to one row that waits for the person's confirmation. Once sent, the list reads again
 * whatever the answer, because a refused row may have changed elsewhere; a refusal keeps the
 * confirmation open with the server's words.
 */
export function useConfirmedChange<Row>({
  send,
  readAgain,
  onDone,
}: {
  send: (row: Row) => Promise<readonly UserErrorLike[]>
  readAgain: () => Promise<unknown>
  onDone: (row: Row) => void
}) {
  const [pending, setPending] = useState<Row | null>(null)
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  async function confirm(row: Row) {
    setRefusal(null)
    setSending(true)
    try {
      const errors = await send(row)
      if (errors.length > 0) setRefusal(errors.map(userErrorMessage).join(' '))
      await readAgain()
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
