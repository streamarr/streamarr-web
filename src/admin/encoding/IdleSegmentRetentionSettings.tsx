import { useMutation, useQuery } from '@apollo/client/react'
import { Button, Center, Loader, NumberInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import {
  ChangeIdleSegmentRetentionDocument,
  IdleSegmentRetentionSettingDocument,
  type IdleSegmentRetentionSettingFieldsFragment,
} from '../../graphql/generated/graphql'
import { requestFailureMessage } from '../../graphql/requestErrors'
import { userErrorMessage } from '../../graphql/userErrors'
import { FailureRow } from '../../ui/Failure'
import styles from '../Settings.module.css'

const DESCRIPTION =
  "How long the server keeps a stream's segments after the last request for them. When the segment folder's disk has less than a tenth free, the server deletes the oldest idle segments sooner."

const UNCONFIRMED =
  "Couldn't confirm the change. Refresh the page to check the saved retention before trying again."

const UNITS = [
  { minutes: 1_440, singular: 'day', plural: 'days' },
  { minutes: 60, singular: 'hour', plural: 'hours' },
  { minutes: 1, singular: 'minute', plural: 'minutes' },
] as const

/**
 * How long the server keeps idle segments. The field shows the setting the server last confirmed
 * until the admin edits it; a refused or unconfirmed save keeps the edit and shows why beside it.
 */
export function IdleSegmentRetentionSettings() {
  const query = useQuery(IdleSegmentRetentionSettingDocument, {
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  })
  const [change, { loading: saving }] = useMutation(ChangeIdleSegmentRetentionDocument)
  const [draft, setDraft] = useState<string | number | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const setting = (query.data ?? query.previousData)?.idleSegmentRetentionSetting

  // A read that answers after a save could put the older value back, so reads and saves never
  // overlap: Save waits for a read in flight, and Retry waits for a save in flight.
  function retry() {
    if (saving) return
    void query.refetch()
  }

  // A correction should not sit under the refusal it answers. An unconfirmed save stays unresolved
  // until the admin checks it, so its message stays.
  function edit(value: string | number) {
    setDraft(value)
    setRefusal((current) => (current === UNCONFIRMED ? current : null))
  }

  async function save(minutes: number, bounds: IdleSegmentRetentionSettingFieldsFragment) {
    // A value too large for GraphQL's Int fails the whole request, which would read as unconfirmed.
    const outside = rangeRefusal(minutes, bounds)
    setRefusal(outside)
    if (outside) return
    try {
      const { data } = await change({ variables: { input: { minutes } } })
      const payload = data?.changeIdleSegmentRetention
      if (payload?.userErrors.length) {
        setRefusal(payload.userErrors.map(userErrorMessage).join(' '))
        return
      }
      if (!payload?.idleSegmentRetentionSetting) {
        setRefusal(UNCONFIRMED)
        return
      }
      if (mounted.current) setDraft(null)
    } catch {
      setRefusal(UNCONFIRMED)
    }
  }

  if (!setting && query.error)
    return (
      <FailureRow onRetry={retry}>
        {requestFailureMessage(query.error, "Couldn't load the idle segment retention.")}
      </FailureRow>
    )
  if (!setting)
    return (
      <Center h={120}>
        <Loader role="status" aria-label="Loading the idle segment retention" />
      </Center>
    )

  return (
    <>
      {query.error && (
        <FailureRow className={styles.failureRow} onRetry={retry}>
          {requestFailureMessage(query.error, "Couldn't load the latest idle segment retention.")}
        </FailureRow>
      )}
      <RetentionForm
        setting={setting}
        value={draft ?? setting.minutes}
        onEdit={edit}
        busy={saving || query.loading}
        saving={saving}
        refusal={refusal}
        onSave={(minutes) => void save(minutes, setting)}
      />
    </>
  )
}

function RetentionForm({
  setting,
  value,
  onEdit,
  busy,
  saving,
  refusal,
  onSave,
}: Readonly<{
  setting: IdleSegmentRetentionSettingFieldsFragment
  value: string | number
  onEdit: (value: string | number) => void
  busy: boolean
  saving: boolean
  refusal: string | null
  onSave: (minutes: number) => void
}>) {
  const minutes = typeof value === 'number' ? value : null
  const changed = minutes !== null && minutes !== setting.minutes

  function submit(event: React.SubmitEvent) {
    event.preventDefault()
    if (minutes === null || !changed || busy) return
    onSave(minutes)
  }

  return (
    <div className={styles.formPanel}>
      <form className={styles.form} onSubmit={submit}>
        <NumberInput
          label="Keep idle segments for"
          description={`${DESCRIPTION} ${allowedRange(setting)}`}
          value={value}
          onChange={onEdit}
          min={setting.minimumMinutes}
          max={setting.maximumMinutes}
          clampBehavior="none"
          allowDecimal={false}
          allowNegative={false}
          hideControls
          rightSection={<span className={styles.fieldNote}>minutes</span>}
          rightSectionWidth={80}
          readOnly={saving}
          error={refusal}
        />
        <div className={styles.formActions}>
          <Button
            type="submit"
            loading={saving}
            disabled={!changed || busy}
            aria-label="Save idle segment retention"
          >
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}

function rangeRefusal(
  minutes: number,
  bounds: IdleSegmentRetentionSettingFieldsFragment,
): string | null {
  if (minutes < bounds.minimumMinutes)
    return `The shortest retention is ${duration(bounds.minimumMinutes)}.`
  if (minutes > bounds.maximumMinutes)
    return `The longest retention is ${duration(bounds.maximumMinutes)}.`
  return null
}

function allowedRange(setting: IdleSegmentRetentionSettingFieldsFragment): string {
  return `Choose from ${duration(setting.minimumMinutes)} to ${duration(setting.maximumMinutes)}.`
}

// Names a whole number of minutes in the largest unit that divides it evenly.
function duration(minutes: number): string {
  const unit = UNITS.find((candidate) => minutes % candidate.minutes === 0) ?? UNITS[2]
  const count = minutes / unit.minutes
  return `${count} ${count === 1 ? unit.singular : unit.plural}`
}
