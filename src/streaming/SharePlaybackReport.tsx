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

/** The figures and stream session that a press of Share takes. */
export type CapturedReport = Omit<Report, 'submissionId'>

type ShareStep =
  { at: 'offered'; shared: boolean } | { at: 'noting'; report: Report; refusal: string | null }

/**
 * Shares the panel with the Server Admin. Pressing Share takes the panel's figures at once, then
 * offers an optional note; Send shares the figures from the press with the note. Each press has its
 * own submission id, which a resend after a lost answer sends again, so the server keeps one report
 * for the press. `capture` is null while no stream is attached, and Share waits for one.
 */
export function SharePlaybackReport({
  capture,
}: Readonly<{ capture: (() => CapturedReport) | null }>) {
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
          disabled={capture === null}
          onClick={
            capture
              ? () => {
                  setNote('')
                  setStep({
                    at: 'noting',
                    report: { ...capture(), submissionId: randomUuid() },
                    refusal: null,
                  })
                }
              : undefined
          }
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
        // The note goes as it stood at Send; a later edit would be lost when the confirmation shows.
        readOnly={sending}
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

// A version 4 UUID. crypto.randomUUID exists only in a secure context, and a server on the local
// network may serve this app over plain HTTP; getRandomValues works in both.
function randomUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
