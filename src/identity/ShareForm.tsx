import { Button, TextInput } from '@mantine/core'
import { useApolloClient, useMutation } from '@apollo/client/react'
import { useEffect, useRef, useState, type Ref, type SubmitEvent } from 'react'
import {
  LookUpShareCodeDocument,
  OfferProfileShareDocument,
  ProfileSharePreviewDocument,
  type ProfileSharePreviewQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, userErrorMessageOr, type UserErrorLike } from '../graphql/userErrors'
import { shareCodeIn } from './shareCode'
import { UPDATE_FAILED_MESSAGE } from './shareText'
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

/**
 * What the server said of a code: an offer to review, a code that does not work, or its words.
 * An answer about a code that the person has since changed is outdated, and shows nothing.
 */
type Answer =
  | { kind: 'review'; review: Review }
  | { kind: 'refused'; message: string }
  | { kind: 'cannot-offer' }
  | { kind: 'failed'; message: string }
  | { kind: 'outdated' }

/** A code that a lookup found, with the name of the Household it names. */
interface LookedUp {
  code: string
  householdName: string
  /** What the server's preview of the offer with this code said, once it has answered. */
  previewed?: Answer
}

const REFUSED: Answer = { kind: 'refused', message: CODE_REFUSED }
const OUTDATED: Answer = { kind: 'outdated' }
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
  codeFromLink = null,
  onCodeFromLinkTaken = () => {},
  onOffered,
  onCancel,
}: Readonly<{
  profile: Readonly<{ id: string; name: string }>
  /** A code that the page's link carried: the form opens with it and continues at once. */
  codeFromLink?: string | null
  onCodeFromLinkTaken?: () => void
  /** Runs once the server took the offer, with the name of the Household it went to. */
  onOffered: (householdName: string) => Promise<void>
  onCancel: () => void
}>) {
  const client = useApolloClient()
  const [lookUp] = useMutation(LookUpShareCodeDocument)
  const [offer] = useMutation(OfferProfileShareDocument)
  const [text, setText] = useState(codeFromLink ?? '')
  /** The text as the person last left it, which an answer about older text no longer concerns. */
  const latestText = useRef(text)
  /** The last code the server found, so that asking about it again costs no second attempt. */
  const lookedUp = useRef<LookedUp | null>(null)
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
      const answer = await askAbout(code)
      show(isOutdated(code) ? OUTDATED : answer)
    } catch (error) {
      if (!isOutdated(code)) setRefusal(requestFailureMessage(error, LOOK_UP_FAILED))
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
    if (isOutdated(code)) return OUTDATED
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

  function isOutdated(code: string): boolean {
    return shareCodeIn(latestText.current) !== code
  }

  async function send(offered: Review) {
    setRefusal(null)
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
      setRefusal(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
    } finally {
      setSending(false)
    }
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
      case 'outdated':
        return
    }
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
          label="Share code from the other Household"
          value={text}
          error={fieldError}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => {
            latestText.current = event.currentTarget.value
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
          {review ? 'Offer share' : 'Continue'}
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
      {effects.wouldLock && <p>{profileName} would arrive locked there until it has a PIN.</p>}
      {effects.nameConflict && (
        <p>
          Another Profile there is already named {profileName}. An admin there cannot accept the
          offer until one of them is renamed.
        </p>
      )}
      <p>An admin of {householdName} must accept it. The code works once.</p>
    </div>
  )
}

function refusalOf(errors: readonly UserErrorLike[]): Answer {
  const refused = errors.find((error) => error.__typename === 'ShareCodeRefusedError')
  if (refused) return { kind: 'refused', message: userErrorMessageOr(refused, CODE_REFUSED) }
  return { kind: 'failed', message: errors.map(userErrorMessage).join(' ') }
}
