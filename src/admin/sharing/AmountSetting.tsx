import { Button, Center, Loader, NumberInput, Select } from '@mantine/core'
import { useRef, useState } from 'react'
import { requestFailureMessage } from '../../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../../graphql/userErrors'
import settingsStyles from '../../styles/settings.module.css'
import { FailureRow } from '../../ui/Failure'
import styles from './AmountSetting.module.css'
import { rangeRefusal, wholeCount, type StoredAmount, type Unit, type Units } from './amounts'

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

/** The field's number, as the admin left it, and the unit it counts. */
interface Draft {
  count: string | number
  unit: Unit
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
 * A server setting that a ServerAdmin sets as a whole number, in one of its `units` when it has
 * more than one. The field shows what the server last confirmed, in the largest unit that holds it
 * whole, until the admin edits it; a refused or unconfirmed save keeps the edit and says why
 * beside it, and a confirmed one goes to the page notice.
 */
export function AmountSetting({
  words,
  units,
  stored,
  read,
  saving,
  save,
  onSaved,
}: Readonly<{
  words: SettingWords
  units: Units
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
        <FailureRow className={settingsStyles.failureRow} onRetry={retry}>
          {requestFailureMessage(read.error, `Couldn't load ${words.subject} again.`)}
        </FailureRow>
      )}
      <AmountForm
        words={words}
        units={units}
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
  units,
  stored,
  busy,
  saving,
  save,
  onSaved,
}: Readonly<{
  words: SettingWords
  units: Units
  stored: StoredAmount
  busy: boolean
  saving: boolean
  save: (amount: number) => Promise<SaveAnswer>
  onSaved: (notice: string) => void
}>) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  // Only a confirmed save resolves an unconfirmed one: a refusal or an edit says nothing about
  // whether the earlier change took effect.
  const [unconfirmed, setUnconfirmed] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const shown: Draft = draft ?? wholeCount(stored.value, units)
  const amount = typeof shown.count === 'number' ? shown.count * shown.unit.size : null
  const changed = amount !== null && amount !== stored.value

  // A correction should not sit under the refusal it answers.
  function edit(next: Draft) {
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
    const outside = rangeRefusal(amount, stored, units)
    setRefusal(outside)
    if (outside) {
      field.current?.focus()
      return
    }
    settle(await attempt(amount))
  }

  return (
    <form ref={form} className={settingsStyles.form} onSubmit={(event) => void submit(event)}>
      <NumberInput
        ref={field}
        size="md"
        label={words.label}
        value={shown.count}
        onChange={(count) => edit({ count, unit: shown.unit })}
        min={Math.ceil(stored.minimum / shown.unit.size)}
        max={Math.floor(stored.maximum / shown.unit.size)}
        clampBehavior="none"
        allowDecimal={false}
        allowNegative={false}
        hideControls
        readOnly={saving}
        error={[refusal, unconfirmed && UNCONFIRMED].filter(Boolean).join(' ') || null}
        inputContainer={(input) =>
          units.length > 1 ? (
            <div className={styles.amount}>
              {input}
              <UnitChoice
                label={words.label}
                units={units}
                shown={shown}
                readOnly={saving}
                onChoose={(unit) => edit({ count: shown.count, unit })}
              />
            </div>
          ) : (
            input
          )
        }
      />
      <div className={settingsStyles.formActions}>
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

/** The unit the field's number counts, named in the singular when the number is one. */
function UnitChoice({
  label,
  units,
  shown,
  readOnly,
  onChoose,
}: Readonly<{
  label: string
  units: Units
  shown: Draft
  readOnly: boolean
  onChoose: (unit: Unit) => void
}>) {
  return (
    <Select
      className={styles.unit}
      classNames={{ dropdown: settingsStyles.popover, option: settingsStyles.popoverOption }}
      aria-label={`${label}, unit`}
      data={units.map((unit) => ({
        value: unit.many,
        label: shown.count === 1 ? unit.one : unit.many,
      }))}
      value={shown.unit.many}
      allowDeselect={false}
      readOnly={readOnly}
      onChange={(value) => {
        const unit = units.find((candidate) => candidate.many === value)
        if (unit) onChoose(unit)
      }}
    />
  )
}
