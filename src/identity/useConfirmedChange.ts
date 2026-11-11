import { useEffect, useEffectEvent, useState } from 'react'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { UPDATE_FAILED_MESSAGE } from './shareText'

/**
 * A change to one row that waits for the person's confirmation. Once sent, the list reads again
 * whatever the answer, because a refused row may have changed elsewhere; a refusal keeps the
 * confirmation open with the server's words. A confirmation whose row a change made elsewhere
 * takes out of the list closes, since confirming it could only fail, and `onGone` says why. A row
 * that leaves while its own request is on its way is that request's to report.
 */
export function useConfirmedChange<Row extends { id: string }>({
  send,
  readAgain,
  onDone,
  listed,
  onGone,
}: {
  send: (row: Row) => Promise<readonly UserErrorLike[]>
  readAgain: () => Promise<unknown>
  onDone: (row: Row) => void
  /** The rows that the page lists now. */
  listed: readonly { id: string }[]
  onGone: (row: Row) => void
}) {
  const [pending, setPending] = useState<Row | null>(null)
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  /** The last row whose confirmation closed because the row left, until the page says so. */
  const [left, setLeft] = useState<{ row: Row } | null>(null)
  if (pending !== null && !sending && !listed.some((row) => row.id === pending.id)) {
    setLeft({ row: pending })
    setPending(null)
    setRefusal(null)
  }
  const sayWhy = useEffectEvent((row: Row) => onGone(row))

  useEffect(() => {
    if (left) sayWhy(left.row)
  }, [left])

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
