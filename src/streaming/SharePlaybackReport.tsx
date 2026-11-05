import { useMutation } from '@apollo/client/react'
import { Alert, Button, Group, Textarea } from '@mantine/core'
import { type FormEvent, useState } from 'react'
import {
  SharePlaybackReportDocument,
  type SharePlaybackReportInput,
} from '../graphql/generated/graphql'
import { userErrorMessage } from '../graphql/userErrors'
import styles from './PlaybackData.module.css'

/** The longest note that a shared playback report holds, in characters. */
export const NOTE_LIMIT = 280

const NOT_SHARED = "Couldn't share the report. Try again."

type Report = Omit<SharePlaybackReportInput, 'note'>

type ShareStep =
  { at: 'offered'; shared: boolean } | { at: 'noting'; report: Report; refusal: string | null }

/**
 * Shares the panel with the Server Admin. Pressing Share takes the panel's figures at once, then
 * offers an optional note; Send shares the figures from the press with the note.
 */
export function SharePlaybackReport({ capture }: Readonly<{ capture: () => Report }>) {
  const [step, setStep] = useState<ShareStep>({ at: 'offered', shared: false })
  const [note, setNote] = useState('')
  const [share, { loading: sending }] = useMutation(SharePlaybackReportDocument)

  if (step.at === 'offered') {
    return (
      <div className={styles.share}>
        {step.shared && (
          <p role="status" className={styles.shared}>
            Shared with your Server Admin.
          </p>
        )}
        <Button
          variant="default"
          size="xs"
          onClick={() => {
            setNote('')
            setStep({ at: 'noting', report: capture(), refusal: null })
          }}
        >
          Share with Server Admin
        </Button>
      </div>
    )
  }

  const { report } = step
  async function send(event: FormEvent) {
    event.preventDefault()
    const refused = (refusal: string) => setStep({ at: 'noting', report, refusal })
    try {
      const { data } = await share({
        variables: { input: { ...report, note: note.trim() ? note : undefined } },
      })
      const payload = data?.sharePlaybackReport
      if (payload?.userErrors.length) {
        refused(payload.userErrors.map(userErrorMessage).join(' '))
        return
      }
      if (!payload?.playbackReportId) {
        refused(NOT_SHARED)
        return
      }
      setStep({ at: 'offered', shared: true })
    } catch {
      refused(NOT_SHARED)
    }
  }

  return (
    <form className={styles.shareForm} onSubmit={(event) => void send(event)}>
      <Textarea
        label="Add a note (optional)"
        description={`${note.length} of ${NOTE_LIMIT} characters`}
        value={note}
        maxLength={NOTE_LIMIT}
        rows={3}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
      {step.refusal && (
        <Alert role="alert" color="red" variant="light" p="xs">
          {step.refusal}
        </Alert>
      )}
      <Group justify="flex-end" gap="xs">
        <Button
          variant="subtle"
          size="xs"
          disabled={sending}
          onClick={() => setStep({ at: 'offered', shared: false })}
        >
          Cancel
        </Button>
        <Button type="submit" size="xs" loading={sending}>
          Send
        </Button>
      </Group>
    </form>
  )
}
