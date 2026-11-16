import { Button } from '@mantine/core'
import { type Ref, useEffect, useId, useRef, useState } from 'react'
import type { ShareCodeStatus } from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { shareCodeLink } from './shareCode'
import styles from './ShareCodes.module.css'
import sharingStyles from './Sharing.module.css'

const UNTIL = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

/** The browser's clipboard, or null where it gives none, as on a page served over plain http. */
export type CodeClipboard = Pick<Clipboard, 'writeText'> | null

/**
 * A share code just issued, shown this once and kept only in this panel: never in the cache, the
 * address or the browser's storage. The person copies the code or its link, then closes the panel.
 * Each code mounts a panel of its own.
 */
export function IssuedShareCode({
  code,
  expiresAt,
  status,
  statusError,
  onStatusRetry,
  clipboard,
  origin,
  onCopied,
  onDone,
  ref,
}: Readonly<{
  code: string | null
  expiresAt: string
  status: ShareCodeStatus | null
  statusError: unknown
  onStatusRetry: () => Promise<unknown>
  clipboard: CodeClipboard
  /** The client's origin, which the link opens the Sharing page on. */
  origin: string
  onCopied: (notice: string) => void
  onDone: () => void
  /** The panel's outer element. */
  ref?: Ref<HTMLDivElement>
}>) {
  const [failure, setFailure] = useState<string | null>(null)
  const shown = useRef<HTMLParagraphElement>(null)
  const sentence = useId()
  const live = status === 'LIVE' && code !== null

  // The code takes focus, so a reader hears it and the sentence that says it shows only now.
  useEffect(() => {
    shown.current?.focus()
  }, [])

  async function copy(text: string, notice: string, failed: string) {
    setFailure(null)
    if (await copied(clipboard, text)) {
      onCopied(notice)
      return
    }
    setFailure(failed)
    // Selected, so the person can copy the code themselves.
    if (shown.current) document.getSelection()?.selectAllChildren(shown.current)
  }

  return (
    <div ref={ref} className={styles.issued}>
      <p
        ref={shown}
        className={live ? styles.code : styles.once}
        tabIndex={-1}
        aria-describedby={live ? sentence : undefined}
        role={live ? undefined : 'status'}
      >
        {live ? code : endedCodeMessage(status)}
      </p>
      {live && (
        <p id={sentence} className={styles.once}>
          {`This is the only time the code is shown. It works until ${UNTIL.format(new Date(expiresAt))}.`}
        </p>
      )}
      {live && failure && (
        <p className={styles.failure} role="alert">
          {failure}
        </p>
      )}
      {statusError !== undefined && (
        <div>
          <p className={styles.failure} role="alert">
            {requestFailureMessage(statusError, "Couldn't check the share code's status.")}
          </p>
          <Button variant="default" onClick={() => void onStatusRetry()}>
            Retry
          </Button>
        </div>
      )}
      {/* At phone width, as in the review of an offer: Copy code across a line, the others under it. */}
      <div className={`${sharingStyles.actions} ${sharingStyles.leadingActions}`}>
        <Button
          disabled={!live}
          onClick={() =>
            code !== null &&
            void copy(
              code,
              'Code copied.',
              "Couldn't copy the code. Select it and copy it yourself.",
            )
          }
        >
          Copy code
        </Button>
        <Button
          variant="default"
          disabled={!live}
          onClick={() =>
            code !== null &&
            void copy(
              shareCodeLink(code, origin),
              'Link copied.',
              "Couldn't copy the link. Select the code and give it instead.",
            )
          }
        >
          Copy link
        </Button>
        <Button variant="default" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

function endedCodeMessage(status: ShareCodeStatus | null): string {
  switch (status) {
    case 'SPENT':
      return 'Someone used this share code to offer a Profile. Check Share invitations for any offers waiting for your answer.'
    case 'WITHDRAWN':
      return 'This share code was withdrawn. To share again, issue a new share code.'
    case 'EXPIRED':
      return 'This share code expired. To share again, issue a new share code.'
    case 'INVALIDATED':
      return 'This share code was withdrawn because its issuer can no longer issue codes for this Household. To share again, issue a new share code.'
    default:
      return 'This share code is no longer available. To share again, issue a new share code.'
  }
}

async function copied(clipboard: CodeClipboard, text: string): Promise<boolean> {
  if (!clipboard) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
