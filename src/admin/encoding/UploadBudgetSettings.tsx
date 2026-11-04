import { useMutation, useQuery } from '@apollo/client/react'
import { Button, Center, Loader, NumberInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import {
  ChangeUploadBudgetDocument,
  UploadBudgetSettingDocument,
  type UploadBudgetSettingFieldsFragment,
} from '../../graphql/generated/graphql'
import { requestFailureMessage } from '../../graphql/requestErrors'
import { userErrorMessage } from '../../graphql/userErrors'
import { FailureRow } from '../../ui/Failure'
import styles from '../Settings.module.css'

const DESCRIPTION =
  "From a speed test of the server's internet connection. Every viewer who isn't on your home network counts against it. When those streams would use more than their share, new streams offer fewer qualities. The budget never blocks playback or direct play. Leave the field empty to turn it off."

const UNCONFIRMED =
  "Couldn't confirm the change. Refresh the page to check the saved upload speed before trying again."

/**
 * The internet upload speed that the upload budget takes its stream share from. The field shows
 * the speed the server last confirmed until the admin edits it; an empty field turns the budget
 * off. A refused or unconfirmed save keeps the edit and shows why beside it.
 */
export function UploadBudgetSettings() {
  const query = useQuery(UploadBudgetSettingDocument, {
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  })
  const [change, { loading: saving }] = useMutation(ChangeUploadBudgetDocument)
  const [draft, setDraft] = useState<string | number | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const setting = (query.data ?? query.previousData)?.uploadBudgetSetting

  // A read that answers after a save could put the older value back, so reads and saves never
  // overlap: Save waits for a read in flight, and Retry waits for a save in flight.
  function retry() {
    if (saving) return
    void query.refetch()
  }

  async function save(megabitsPerSecond: number | null) {
    setRefusal(null)
    try {
      const { data } = await change({
        variables: { input: { internetUploadMegabitsPerSecond: megabitsPerSecond } },
        update(cache, { data: result }) {
          // A save that answers after the admin left may be older than a save made on return.
          const saved = result?.changeUploadBudget?.uploadBudgetSetting
          if (saved && mounted.current)
            cache.writeQuery({
              query: UploadBudgetSettingDocument,
              data: { uploadBudgetSetting: saved },
            })
        },
      })
      const payload = data?.changeUploadBudget
      if (payload?.userErrors.length) {
        setRefusal(payload.userErrors.map(userErrorMessage).join(' '))
        return
      }
      if (!payload?.uploadBudgetSetting) {
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
        {requestFailureMessage(query.error, "Couldn't load the upload budget.")}
      </FailureRow>
    )
  if (!setting)
    return (
      <Center h={120}>
        <Loader role="status" aria-label="Loading the upload budget" />
      </Center>
    )

  return (
    <>
      {query.error && (
        <FailureRow className={styles.failureRow} onRetry={retry}>
          {requestFailureMessage(query.error, "Couldn't load the latest upload budget.")}
        </FailureRow>
      )}
      <UploadBudgetForm
        setting={setting}
        value={draft ?? setting.internetUploadMegabitsPerSecond ?? ''}
        onEdit={setDraft}
        busy={saving || query.loading}
        saving={saving}
        refusal={refusal}
        onSave={(megabitsPerSecond) => void save(megabitsPerSecond)}
      />
    </>
  )
}

function UploadBudgetForm({
  setting,
  value,
  onEdit,
  busy,
  saving,
  refusal,
  onSave,
}: Readonly<{
  setting: UploadBudgetSettingFieldsFragment
  value: string | number
  onEdit: (value: string | number) => void
  busy: boolean
  saving: boolean
  refusal: string | null
  onSave: (megabitsPerSecond: number | null) => void
}>) {
  const requested = requestedSpeed(value)
  const changed = requested !== undefined && requested !== setting.internetUploadMegabitsPerSecond

  function submit(event: React.SubmitEvent) {
    event.preventDefault()
    if (requested === undefined || !changed || busy) return
    onSave(requested)
  }

  return (
    <div className={`${styles.formPanel} ${styles.followingPanel}`}>
      <form className={styles.form} onSubmit={submit}>
        <NumberInput
          label="Internet upload speed"
          description={DESCRIPTION}
          placeholder="Off"
          value={value}
          onChange={onEdit}
          min={setting.minimumInternetUploadMegabitsPerSecond}
          max={setting.maximumInternetUploadMegabitsPerSecond}
          clampBehavior="none"
          allowDecimal={false}
          allowNegative={false}
          hideControls
          rightSection={<span className={styles.fieldNote}>Mb/s</span>}
          rightSectionWidth={64}
          readOnly={saving}
          error={refusal}
        />
        <div>
          <p className={styles.fieldNote}>{shareLine(setting)}</p>
          <p className={styles.fieldNote}>
            From {megabits(setting.minimumInternetUploadMegabitsPerSecond)} to{' '}
            {megabits(setting.maximumInternetUploadMegabitsPerSecond)} Mb/s.
          </p>
        </div>
        <div className={styles.formActions}>
          <Button
            type="submit"
            loading={saving}
            disabled={!changed || busy}
            aria-label="Save internet upload speed"
          >
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}

// An empty field asks to turn the budget off; an entry that is not yet a number asks for nothing.
function requestedSpeed(value: string | number): number | null | undefined {
  if (value === '') return null
  return typeof value === 'number' ? value : undefined
}

function shareLine(setting: UploadBudgetSettingFieldsFragment): string {
  const speed = setting.internetUploadMegabitsPerSecond
  const share = setting.streamShareMegabitsPerSecond
  if (speed == null || share == null) return 'Off: streams use as much upload as they need.'
  return `Streams use up to ${setting.streamSharePercent}%: ${megabits(share)} of ${megabits(speed)} Mb/s.`
}

function megabits(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
