import { Button, Center, Loader, NumberInput } from '@mantine/core'
import { useRef, useState } from 'react'
import { requestFailureMessage } from '../../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../../graphql/userErrors'
import styles from '../../styles/settings.module.css'
import { FailureRow } from '../../ui/Failure'
import { rangeRefusal, type StoredAmount, type Unit } from './amounts'

const UNCONFIRMED =
  "Couldn't confirm the change. Refresh the page to check the saved setting before trying again."

/** How the server answered a save. */
export type SaveAnswer =
  { kind: 'saved'; value: number } | { kind: 'refused'; message: string } | { kind: 'unconfirmed' }

/** The read of a setting, as its query gives it. */
export interface SettingRead {
  error?: unknown
  loading: boolean
  refetch: () => Promise<unknown>
}

/** What the page calls a setting. */
export interface SettingWords {
  label: string
  /** What loading, failing and saving name, such as "the share code limit". */
  subject: string
  /** The page notice once the server confirms a save of `value`. */
  saved: (value: number) => string
}

/** A save's answer from a change payload: its refusals, or the value the server stored. */
export function answerOf(
  userErrors: readonly UserErrorLike[] | undefined,
  saved: number | undefined,
): SaveAnswer {
  if (userErrors?.length) {
    return { kind: 'refused', message: userErrors.map(userErrorMessage).join(' ') }
  }
  if (saved === undefined) return { kind: 'unconfirmed' }
  return { kind: 'saved', value: saved }
}

/**
 * A server setting that a ServerAdmin sets as a whole number. The field shows what the server last
 * confirmed until the admin edits it; a refused or unconfirmed save keeps the edit and says why
 * beside it, and a confirmed one goes to the page notice.
 */
export function AmountSetting({
  words,
  unit,
  stored,
  read,
  saving,
  save,
  onSaved,
}: Readonly<{
  words: SettingWords
  unit: Unit
  stored: StoredAmount | undefined
  read: SettingRead
  saving: boolean
  save: (amount: number) => Promise<SaveAnswer>
  onSaved: (notice: string) => void
}>) {
  // A read that answers after a save could put the older value back, so reads and saves never
  // overlap: Save waits for a read in flight, and Retry waits for a save in flight.
  function retry() {
    if (saving) return
    read.refetch().catch(() => undefined)
  }

  if (!stored && read.error)
    return (
      <FailureRow onRetry={retry}>
        {requestFailureMessage(read.error, `Couldn't load ${words.subject}.`)}
      </FailureRow>
    )
  if (!stored)
    return (
      <Center h={120}>
        <Loader role="status" aria-label={`Loading ${words.subject}`} />
      </Center>
    )

  return (
    <>
      {read.error && (
        <FailureRow className={styles.failureRow} onRetry={retry}>
          {requestFailureMessage(read.error, `Couldn't load ${words.subject} again.`)}
        </FailureRow>
      )}
      <AmountForm
        words={words}
        unit={unit}
        stored={stored}
        busy={saving || read.loading}
        saving={saving}
        save={save}
        onSaved={onSaved}
      />
    </>
  )
}

function AmountForm({
  words,
  unit,
  stored,
  busy,
  saving,
  save,
  onSaved,
}: Readonly<{
  words: SettingWords
  unit: Unit
  stored: StoredAmount
  busy: boolean
  saving: boolean
  save: (amount: number) => Promise<SaveAnswer>
  onSaved: (notice: string) => void
}>) {
  const [draft, setDraft] = useState<string | number | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  // Only a confirmed save resolves an unconfirmed one: a refusal or an edit says nothing about
  // whether the earlier change took effect.
  const [unconfirmed, setUnconfirmed] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const value = draft ?? stored.value
  const amount = typeof value === 'number' ? value : null
  const changed = amount !== null && amount !== stored.value

  // A correction should not sit under the refusal it answers.
  function edit(next: string | number) {
    setDraft(next)
    setRefusal(null)
  }

  // Save is disabled while it waits, which drops focus, so the answer brings focus back to the
  // field; focus the admin has since put elsewhere on the page stays there.
  function returnFocus() {
    const active = document.activeElement
    if (active && active !== document.body && !form.current?.contains(active)) return
    field.current?.focus()
  }

  async function attempt(next: number): Promise<SaveAnswer> {
    try {
      return await save(next)
    } catch {
      return { kind: 'unconfirmed' }
    }
  }

  function settle(answer: SaveAnswer) {
    returnFocus()
    if (answer.kind === 'refused') {
      setRefusal(answer.message)
      return
    }
    if (answer.kind === 'unconfirmed') {
      setUnconfirmed(true)
      return
    }
    setUnconfirmed(false)
    setDraft(null)
    onSaved(words.saved(answer.value))
  }

  async function submit(event: React.SubmitEvent) {
    event.preventDefault()
    if (amount === null || !changed || busy) return
    // A value too large for GraphQL's Int fails the whole request, which would read as unconfirmed.
    const outside = rangeRefusal(amount, stored, unit)
    setRefusal(outside)
    if (outside) {
      field.current?.focus()
      return
    }
    settle(await attempt(amount))
  }

  return (
    <form ref={form} className={styles.form} onSubmit={(event) => void submit(event)}>
      <NumberInput
        ref={field}
        size="md"
        label={words.label}
        value={value}
        onChange={edit}
        min={stored.minimum}
        max={stored.maximum}
        clampBehavior="none"
        allowDecimal={false}
        allowNegative={false}
        hideControls
        readOnly={saving}
        error={[refusal, unconfirmed && UNCONFIRMED].filter(Boolean).join(' ') || null}
      />
      <div className={styles.formActions}>
        <Button
          type="submit"
          loading={saving}
          disabled={!changed || busy}
          aria-label={`Save ${words.subject}`}
        >
          Save
        </Button>
      </div>
    </form>
  )
}
