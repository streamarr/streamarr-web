import { Button, TextInput } from '@mantine/core'
import { useApolloClient, useMutation } from '@apollo/client/react'
import { useEffect, useRef, useState, type ReactNode, type Ref, type SubmitEvent } from 'react'
import {
  LookUpShareCodeDocument,
  OfferProfileShareDocument,
  ProfileSharePreviewDocument,
  type ProfileSharePreviewQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage, serverFailureSentence } from '../graphql/requestErrors'
import { userErrorMessage, userErrorMessageOr, type UserErrorLike } from '../graphql/userErrors'
import { Icon } from '../ui/Icon'
import { shareCodeIn } from './shareCode'
import styles from './Sharing.module.css'

const NOT_A_CODE = 'A share code is 8 letters, like BCDF-GHJK.'
// The server's own words, for an answer that refuses the code without any.
const CODE_REFUSED = 'This share code does not work. Ask the Household for a new one.'
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
  | { kind: 'review'; review: Review }
  | { kind: 'refused'; message: string }
  | { kind: 'cannot-offer' }
  | { kind: 'failed'; message: string }

/** A code that a lookup found, with the name of the Household it names. */
interface LookedUp {
  code: string
  householdName: string
  /** What the server's preview of the offer with this code said, once it has answered. */
  previewed?: Answer
}

const REFUSED: Answer = { kind: 'refused', message: CODE_REFUSED }
// The server answers no preview for a code that stopped working and for a Profile that the
// Account may not offer, and does not say which.
const CANNOT_OFFER: Answer = { kind: 'cannot-offer' }

/**
 * Offers a Profile to the Household that a share code names, in two steps: the code, then a review
 * of the offer that names the Household and says what the offer would do to the Profile there.
 * Every lookup counts against the Account, so the server hears of a code only when the person
 * continues, never of text that cannot be one, and only once of a code that it found.
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
  /** The last code the server found, so that asking about it again costs no second attempt. */
  const lookedUp = useRef<LookedUp | null>(null)
  /** Why the text cannot go on, and which refusal this is: each is written anew, to be heard. */
  const [fieldError, setFieldError] = useState<{ reason: string; count: number } | null>(null)
  const refusals = useRef(0)
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

  // The preview is asked here, and never as a watched query: every request is an attempt. A code
  // the server has previewed gets the same answer again without asking.
  async function askAbout(code: string): Promise<Answer> {
    const found = await lookUpOnce(code)
    if ('kind' in found) return found
    if (found.previewed) return found.previewed
    const previewed = await client.query({
      query: ProfileSharePreviewDocument,
      variables: { profileId: profile.id, shareCode: code },
      fetchPolicy: 'no-cache',
    })
    const effects = previewed.data?.profileSharePreview
    const answer: Answer = effects
      ? { kind: 'review', review: { code, householdName: found.householdName, effects } }
      : CANNOT_OFFER
    if (lookedUp.current?.code === code)
      lookedUp.current = { ...lookedUp.current, previewed: answer }
    return answer
  }

  /** Looks a code up, unless the server already found it: a preview that failed asks only again. */
  async function lookUpOnce(code: string): Promise<LookedUp | Answer> {
    if (lookedUp.current?.code === code) return lookedUp.current
    const { data } = await lookUp({ variables: { input: { code } } })
    const householdName = data?.lookUpShareCode?.householdName
    const errors = data?.lookUpShareCode?.userErrors ?? []
    if (errors.length > 0) return refusalOf(errors)
    if (!householdName) return REFUSED
    lookedUp.current = { code, householdName }
    return lookedUp.current
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
    switch (answer.kind) {
      case 'refused':
        // A code that no longer works is looked up afresh, should the person try it again.
        lookedUp.current = null
        refuseText(answer.message)
        return
      case 'failed':
        setRefusal(answer.message)
        return
      case 'cannot-offer':
        setRefusal(
          `This offer cannot be made. The code may have stopped working, or you may not be able to share ${profile.name}.`,
        )
        return
      case 'review':
        setReview(answer.review)
        return
    }
  }

  /** Back to the code step, the text kept, with the reason it cannot go on. */
  function refuseText(reason: string) {
    setReview(null)
    refusals.current += 1
    setFieldError({ reason, count: refusals.current })
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
    <form className={styles.shareForm} noValidate onSubmit={submit} data-testid="share-form">
      {review ? (
        <ShareReview profileName={profile.name} review={review} questionRef={question} />
      ) : (
        <TextInput
          ref={field}
          label="Share code from the other Household"
          value={text}
          readOnly={sending}
          // Announced as it arrives: Enter leaves focus in the field, whose description is not read.
          error={fieldError && <span key={fieldError.count}>{fieldError.reason}</span>}
          errorProps={{ role: 'alert' }}
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
      <div className={review ? `${styles.actions} ${styles.reviewActions}` : styles.actions}>
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
        <ReviewWarning>
          {profileName}'s Profile would be locked there until it has a PIN.
        </ReviewWarning>
      )}
      {effects.nameConflict && (
        <ReviewWarning>
          Another Profile there is already named {profileName}. An admin there cannot accept the
          share invitation until one of them is renamed.
        </ReviewWarning>
      )}
      <p>An admin of {householdName} must accept it. The code works once.</p>
    </div>
  )
}

/** What the offer would do that the person may not expect, marked as a caution, not a fault. */
function ReviewWarning({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p className={styles.warning}>
      <Icon name="alert" size={16} />
      <span>{children}</span>
    </p>
  )
}

function refusalOf(errors: readonly UserErrorLike[]): Answer {
  const refused = errors.find((error) => error.__typename === 'ShareCodeRefusedError')
  if (refused) return { kind: 'refused', message: userErrorMessageOr(refused, CODE_REFUSED) }
  return { kind: 'failed', message: errors.map(userErrorMessage).join(' ') }
}
