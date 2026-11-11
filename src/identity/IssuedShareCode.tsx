import { Button } from '@mantine/core'
import { useEffect, useId, useRef, useState } from 'react'
import { shareCodeLink } from './shareCode'
import styles from './ShareCodes.module.css'

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
  clipboard,
  origin,
  onCopied,
  onDone,
}: Readonly<{
  code: string
  expiresAt: string
  clipboard: CodeClipboard
  /** The client's origin, which the link opens the Sharing page on. */
  origin: string
  onCopied: (notice: string) => void
  onDone: () => void
}>) {
  const [failure, setFailure] = useState<string | null>(null)
  const shown = useRef<HTMLParagraphElement>(null)
  const sentence = useId()

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
    <div className={styles.issued}>
      <p ref={shown} className={styles.code} tabIndex={-1} aria-describedby={sentence}>
        {code}
      </p>
      <p id={sentence} className={styles.once}>
        {`This is the only time the code is shown. It works until ${UNTIL.format(new Date(expiresAt))}.`}
      </p>
      {failure && (
        <p className={styles.failure} role="alert">
          {failure}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          variant="default"
          onClick={() =>
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
          onClick={() =>
            void copy(
              shareCodeLink(code, origin),
              'Link copied.',
              "Couldn't copy the link. Select the code and give it instead.",
            )
          }
        >
          Copy link
        </Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  )
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
