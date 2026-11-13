import { Button, TextInput } from '@mantine/core'
import { useApolloClient, useMutation } from '@apollo/client/react'
import { useEffect, useRef, useState, type Ref, type SubmitEvent } from 'react'
import {
  LookUpShareCodeDocument,
  OfferProfileShareDocument,
  ProfileSharePreviewDocument,
  type ProfileSharePreviewQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage, serverFailureSentence } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { shareCodeIn } from './shareCode'
import styles from './Sharing.module.css'

const NOT_A_CODE = 'A share code is 8 letters, like BCDF-GHJK.'
const CODE_REFUSED = 'That code does not work. Ask an admin there for a new one.'
const LOOK_UP_FAILED = "Couldn't check that code."

type Effects = NonNullable<ProfileSharePreviewQuery['profileSharePreview']>

/** An offer waiting for the person's word: the code that names the Household, and its effects. */
interface Review {
  code: string
  householdName: string
  effects: Effects
}

/** What the server said of a code: an offer to review, a code that does not work, or its words. */
type Answer =
  { kind: 'review'; review: Review } | { kind: 'refused' } | { kind: 'failed'; message: string }

const REFUSED: Answer = { kind: 'refused' }

/**
 * Offers a Profile to the Household that a share code names, in two steps: the code, then a review
 * of the offer that names the Household and says what the offer would do to the Profile there.
 * Every lookup counts against the Account, so the server hears of a code only when the person
 * continues, and never of text that cannot be one.
 */
export function ShareForm({
  profile,
  onSend,
  codeFromLink = null,
  onCodeFromLinkTaken = () => {},
  onOffered,
  onAnswerLost,
  onCancel,
}: Readonly<{
  profile: Readonly<{ id: string; name: string }>
  /** Called when the person sends the share, before the server answers. */
  onSend: () => void
  /** A code that the page's link carried: the form opens with it and continues at once. */
  codeFromLink?: string | null
  onCodeFromLinkTaken?: () => void
  /** Runs once the server took the offer, with the name of the Household it went to. */
  onOffered: (householdName: string) => Promise<void>
  /**
   * Runs when the offer failed without the server's words, so the server may have made it. The
   * form keeps the review, and its Offer share is the retry.
   */
  onAnswerLost: () => Promise<void>
  onCancel: () => void
}>) {
  const client = useApolloClient()
  const [lookUp] = useMutation(LookUpShareCodeDocument)
  const [offer] = useMutation(OfferProfileShareDocument)
  const [text, setText] = useState(codeFromLink ?? '')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [sending, setSending] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const question = useRef<HTMLHeadingElement>(null)
  /** Set once the link's code is on its way, so that no second mount asks about it again. */
  const linkCodeTaken = useRef(false)
  const reviewing = review !== null

  // The code step starts in its field, and the review in its question, so a reader hears it.
  useEffect(() => {
    ;(reviewing ? question : field).current?.focus()
  }, [reviewing])

  useEffect(() => {
    if (codeFromLink === null || linkCodeTaken.current) return
    linkCodeTaken.current = true
    onCodeFromLinkTaken()
    void continueWith(codeFromLink)
  })

  async function continueWith(typed: string) {
    setRefusal(null)
    setFieldError(null)
    const code = shareCodeIn(typed)
    if (code === null) {
      refuseText(NOT_A_CODE)
      return
    }
    setSending(true)
    try {
      show(await askAbout(code))
    } catch (error) {
      setRefusal(requestFailureMessage(error, LOOK_UP_FAILED))
    } finally {
      setSending(false)
    }
  }

  // The preview is asked once, here, and never as a watched query: every request is an attempt.
  async function askAbout(code: string): Promise<Answer> {
    const { data } = await lookUp({ variables: { input: { code } } })
    const householdName = data?.lookUpShareCode?.householdName
    const errors = data?.lookUpShareCode?.userErrors ?? []
    if (errors.length > 0) return refusalOf(errors)
    if (!householdName) return REFUSED
    const previewed = await client.query({
      query: ProfileSharePreviewDocument,
      variables: { profileId: profile.id, shareCode: code },
      fetchPolicy: 'no-cache',
    })
    const effects = previewed.data?.profileSharePreview
    if (!effects) return REFUSED
    return { kind: 'review', review: { code, householdName, effects } }
  }

  async function send(offered: Review) {
    setRefusal(null)
    onSend()
    setSending(true)
    try {
      const { data } = await offer({
        variables: { input: { profileId: profile.id, shareCode: offered.code } },
      })
      const errors = data?.offerProfileShare?.userErrors ?? []
      if (errors.length > 0) {
        show(refusalOf(errors))
        return
      }
      await onOffered(offered.householdName)
    } catch (error) {
      await failed(error)
    } finally {
      setSending(false)
    }
  }

  // An outage is not a verdict: only the server's words say that it did not make the offer.
  async function failed(error: unknown) {
    const words = serverFailureSentence(error)
    if (words === null) {
      await onAnswerLost()
      return
    }
    setRefusal(words)
  }

  function show(answer: Answer) {
    if (answer.kind === 'refused') {
      refuseText(CODE_REFUSED)
      return
    }
    if (answer.kind === 'failed') {
      setRefusal(answer.message)
      return
    }
    setReview(answer.review)
  }

  /** Back to the code step, the text kept, with the reason it cannot go on. */
  function refuseText(reason: string) {
    setReview(null)
    setFieldError(reason)
    field.current?.focus()
  }

  function back() {
    setRefusal(null)
    setReview(null)
  }

  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (sending) return
    if (review) {
      void send(review)
      return
    }
    void continueWith(text)
  }

  return (
    <form className={styles.shareForm} noValidate onSubmit={submit}>
      {review ? (
        <ShareReview profileName={profile.name} review={review} questionRef={question} />
      ) : (
        <TextInput
          ref={field}
          label="Share code"
          description="An admin of the other Household gives you this code."
          value={text}
          readOnly={sending}
          error={fieldError}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => {
            setText(event.currentTarget.value)
            setFieldError(null)
          }}
        />
      )}
      {refusal && (
        <p className={styles.refusal} role="alert">
          {refusal}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" loading={sending}>
          {review ? 'Send invitation' : 'Continue'}
        </Button>
        {review && (
          <Button variant="default" disabled={sending} onClick={back}>
            Back
          </Button>
        )}
        <Button variant="default" disabled={sending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ShareReview({
  profileName,
  review: { householdName, effects },
  questionRef,
}: Readonly<{ profileName: string; review: Review; questionRef: Ref<HTMLHeadingElement> }>) {
  return (
    <div className={styles.review}>
      <h3 ref={questionRef} tabIndex={-1} className={styles.question}>
        Offer {profileName} to {householdName}?
      </h3>
      {effects.wouldLock && (
        <p>{profileName}'s Profile would be locked there until it has a PIN.</p>
      )}
      {effects.nameConflict && (
        <p>
          Another Profile there is already named {profileName}. An admin there cannot accept the
          share invitation until one of them is renamed.
        </p>
      )}
      <p>An admin of {householdName} must accept it. The code works once.</p>
    </div>
  )
}

function refusalOf(errors: readonly UserErrorLike[]): Answer {
  if (errors.some((error) => error.__typename === 'ShareCodeRefusedError')) return REFUSED
  return { kind: 'failed', message: errors.map(userErrorMessage).join(' ') }
}
