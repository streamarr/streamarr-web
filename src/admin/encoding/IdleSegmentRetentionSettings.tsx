import { useMutation, useQuery } from '@apollo/client/react'
import { Button, Center, Loader, NumberInput } from '@mantine/core'
import { useEffect, useRef, useState, type FormEvent } from 'react'
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
 * How long the server keeps idle segments. The field starts from the setting the server last
 * confirmed; a refused or unconfirmed save keeps the entered value and shows why beside it.
 */
export function IdleSegmentRetentionSettings() {
  const query = useQuery(IdleSegmentRetentionSettingDocument, { fetchPolicy: 'cache-and-network' })
  const setting = (query.data ?? query.previousData)?.idleSegmentRetentionSetting

  if (!setting && query.error)
    return (
      <FailureRow onRetry={query.refetch}>
        {requestFailureMessage(query.error, "Couldn't load the idle segment retention.")}
      </FailureRow>
    )
  if (!setting)
    return (
      <Center h={120}>
        <Loader role="status" aria-label="Loading the idle segment retention" />
      </Center>
    )

  // A newly confirmed value starts a fresh form, so the field never shows a stale draft.
  return <RetentionForm key={setting.minutes} setting={setting} />
}

function RetentionForm({
  setting,
}: Readonly<{ setting: IdleSegmentRetentionSettingFieldsFragment }>) {
  const [change, { loading: saving }] = useMutation(ChangeIdleSegmentRetentionDocument)
  const [draft, setDraft] = useState<string | number>(setting.minutes)
  const [refusal, setRefusal] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const minutes = typeof draft === 'number' ? draft : null
  const changed = minutes !== null && minutes !== setting.minutes

  async function save(event: FormEvent) {
    event.preventDefault()
    if (minutes === null || !changed || saving) return
    setRefusal(null)
    try {
      const { data } = await change({
        variables: { input: { minutes } },
        update(cache, { data: result }) {
          // A save that answers after the admin left may be older than a save made on return.
          const saved = result?.changeIdleSegmentRetention?.idleSegmentRetentionSetting
          if (saved && mounted.current)
            cache.writeQuery({
              query: IdleSegmentRetentionSettingDocument,
              data: { idleSegmentRetentionSetting: saved },
            })
        },
      })
      const payload = data?.changeIdleSegmentRetention
      if (payload?.userErrors.length) {
        setRefusal(payload.userErrors.map(userErrorMessage).join(' '))
        return
      }
      if (!payload?.idleSegmentRetentionSetting) setRefusal(UNCONFIRMED)
    } catch {
      setRefusal(UNCONFIRMED)
    }
  }

  return (
    <div className={styles.formPanel}>
      <form className={styles.form} onSubmit={(event) => void save(event)}>
        <NumberInput
          label="Keep idle segments for"
          description={DESCRIPTION}
          value={draft}
          onChange={setDraft}
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
        <p className={styles.fieldNote}>
          From {duration(setting.minimumMinutes)} to {duration(setting.maximumMinutes)}.
        </p>
        <div className={styles.formActions}>
          <Button
            type="submit"
            loading={saving}
            disabled={!changed}
            aria-label="Save idle segment retention"
          >
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}

// Names a whole number of minutes in the largest unit that divides it evenly.
function duration(minutes: number): string {
  const unit = UNITS.find((candidate) => minutes % candidate.minutes === 0) ?? UNITS[2]
  const count = minutes / unit.minutes
  return `${count} ${count === 1 ? unit.singular : unit.plural}`
}
