import { Button, TextInput } from '@mantine/core'
import { useMutation, useQuery } from '@apollo/client/react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  OfferProfileShareDocument,
  ProfileSharePreviewDocument,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage } from '../graphql/userErrors'
import { householdIdIn, UPDATE_FAILED_MESSAGE } from './shareText'
import styles from './Sharing.module.css'

/**
 * Offers a Profile to the Household whose id the person enters. The id may come pasted with the
 * text around it. Before the offer, the server says what it would do to the Profile there.
 */
export function ShareForm({
  profile,
  onSend,
  onOffered,
  onCancel,
}: Readonly<{
  profile: Readonly<{ id: string; name: string }>
  /** Called when the person sends the share, before the server answers. */
  onSend: () => void
  onOffered: () => Promise<void>
  onCancel: () => void
}>) {
  const [text, setText] = useState('')
  /** The person sent text that holds no Household id. */
  const [notAnId, setNotAnId] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const householdId = householdIdIn(text)
  const preview = useQuery(ProfileSharePreviewDocument, {
    variables: { profileId: profile.id, householdId: householdId ?? '' },
    skip: householdId === null,
  })
  const [offer] = useMutation(OfferProfileShareDocument)

  useEffect(() => {
    field.current?.focus()
  }, [])

  const effects = householdId === null ? undefined : preview.data?.profileSharePreview
  const noSuchHousehold = effects === null

  async function submit(event: FormEvent) {
    event.preventDefault()
    setRefusal(null)
    if (householdId === null) {
      setNotAnId(true)
      return
    }
    if (noSuchHousehold) return
    onSend()
    setSending(true)
    try {
      await send(householdId)
    } catch (error) {
      setRefusal(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
    } finally {
      setSending(false)
    }
  }

  async function send(target: string) {
    const result = await offer({
      variables: { input: { profileId: profile.id, householdId: target } },
    })
    const errors = result.data?.offerProfileShare?.userErrors
    if (errors?.length) {
      setRefusal(errors.map(userErrorMessage).join(' '))
      return
    }
    await onOffered()
  }

  return (
    <form className={styles.shareForm} noValidate onSubmit={(event) => void submit(event)}>
      <TextInput
        ref={field}
        label="Household ID"
        value={text}
        error={fieldError(notAnId, noSuchHousehold)}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setText(event.currentTarget.value)
          setNotAnId(false)
        }}
      />
      <div className={styles.effects} aria-live="polite">
        {effects?.wouldLock && (
          <p>{profile.name}'s Profile would be locked there until it has a PIN.</p>
        )}
        {effects?.nameConflict && (
          <p>
            Another Profile there is already named {profile.name}. An admin there cannot accept the
            share invitation until one of them is renamed.
          </p>
        )}
      </div>
      {refusal && (
        <p className={styles.refusal} role="alert">
          {refusal}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" loading={sending} disabled={text.trim() === '' || noSuchHousehold}>
          Send invitation
        </Button>
        <Button variant="default" disabled={sending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function fieldError(notAnId: boolean, noSuchHousehold: boolean): string | null {
  if (notAnId) return 'That is not a Household ID.'
  if (noSuchHousehold) return 'No Household has that ID.'
  return null
}
