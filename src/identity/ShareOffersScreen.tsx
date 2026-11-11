import { Button, Center, Loader } from '@mantine/core'
import { useMutation } from '@apollo/client/react'
import { useEffect, useEffectEvent, useState, type Ref } from 'react'
import {
  AcceptProfileShareDocument,
  RejectProfileShareDocument,
  type MeQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import settingsStyles from '../styles/settings.module.css'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FailurePanel } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { useFocusFallback } from '../ui/useFocusFallback'
import { usePageNotice } from '../ui/usePageNotice'
import styles from './Sharing.module.css'
import { SharedProfileText } from './SharedProfileText'
import { SharingSection } from './SharingSection'
import { expiryLabel, UPDATE_FAILED_MESSAGE } from './shareText'
import { useMe } from './useMe'
import { useWaitingOffers, type PendingOffer } from './useWaitingOffers'

type OfferedProfile = PendingOffer['profile']
type Household = MeQuery['me']['household']
type Decision = 'accept' | 'decline'
/** An offer whose decision waits for the admin's confirmation. */
type Confirmation = Readonly<{ offerId: string; decision: Decision }>

const NO_LONGER_WAITING = 'That offer is no longer waiting.'

/** The offers of Profiles to the Account's Household, which its admins accept or decline. */
export function ShareOffersScreen() {
  const { notice, count, heading, announce, dismiss } = usePageNotice()
  const liveList = useFocusFallback(heading)

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Share invitations
        </h1>
      </div>
      <PageNotice count={count} onDismiss={dismiss}>
        {notice}
      </PageNotice>
      <ShareOffersContent onDecided={announce} liveList={liveList} />
    </>
  )
}

function ShareOffersContent({
  onDecided,
  liveList,
}: Readonly<{ onDecided: (notice: string) => void; liveList: Ref<HTMLDivElement> }>) {
  const me = useMe()

  if (me.loading && !me.data) {
    return <ShareOffersLoading />
  }
  if (me.error || !me.data) {
    return <ShareOffersUnavailable error={me.error} onRetry={me.refetch} />
  }
  return (
    <HouseholdOffers
      household={me.data.me.household}
      serverAdmin={me.data.me.serverAdmin}
      onDecided={onDecided}
      liveList={liveList}
    />
  )
}

function HouseholdOffers({
  household,
  serverAdmin,
  onDecided,
  liveList,
}: Readonly<{
  household: Household
  serverAdmin: boolean
  onDecided: (notice: string) => void
  /** The container of the offers, where focus that a change takes away returns to the heading. */
  liveList: Ref<HTMLDivElement>
}>) {
  // Offers arrive, expire and are withdrawn elsewhere, so a visit shows only the server's answer.
  const { query, offers } = useWaitingOffers(
    { householdId: household.id, serverAdmin },
    { fetchPolicy: 'network-only' },
  )
  const [accept] = useMutation(AcceptProfileShareDocument)
  const [decline] = useMutation(RejectProfileShareDocument)
  /**
   * The offer whose acceptance or decline waits for the admin's confirmation. The confirmation shows
   * the offer as the latest read lists it, and closes when that read no longer lists the offer.
   */
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  /** The offer whose decision is on its way; no other decision starts until it lands. */
  const [deciding, setDeciding] = useState<string | null>(null)
  /**
   * Whether a decision, or the read of the offers that follows it, is on its way. No confirmation
   * confirms until that read answers: a read sent before one decision could otherwise answer after a
   * second decision and bring back the second offer.
   */
  const [changing, setChanging] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  // The query keeps a failed read, and the page shows it in place of the list. Rejecting here
  // would report the decision that the read follows as failed.
  const readAgain = () => query.refetch().catch(() => undefined)

  /**
   * Sends the decision and closes its confirmation once the server takes it; a refusal keeps the
   * confirmation open with the server's words. Either way the offers are then read again.
   */
  async function decide(offer: PendingOffer, decision: Decision) {
    setRefusal(null)
    setDeciding(offer.id)
    setChanging(true)
    try {
      const answered = await sendAndSettle(offer, decision)
      setDeciding(null)
      // A refused offer may have been decided or withdrawn elsewhere, so the list is read again.
      if (answered) await readAgain()
    } finally {
      setChanging(false)
    }
  }

  /** Settles the decision by the server's answer; false when the request got no answer. */
  async function sendAndSettle(offer: PendingOffer, decision: Decision): Promise<boolean> {
    try {
      const errors = await send(offer, decision)
      if (errors?.length) {
        setRefusal(errors.map(userErrorMessage).join(' '))
        return true
      }
      setConfirmation(null)
      onDecided(
        decision === 'accept'
          ? `${offeredProfile(offer)} accepted into ${household.name}.`
          : `Share invitation for ${offeredProfile(offer)} declined.`,
      )
      return true
    } catch (error) {
      setRefusal(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
      return false
    }
  }

  async function send(
    offer: PendingOffer,
    decision: Decision,
  ): Promise<readonly UserErrorLike[] | undefined> {
    const variables = { input: { shareId: offer.id } }
    if (decision === 'accept') {
      return (await accept({ variables })).data?.acceptProfileShare?.userErrors
    }
    return (await decline({ variables })).data?.rejectProfileShare?.userErrors
  }

  function ask(offer: PendingOffer, decision: Decision) {
    setRefusal(null)
    setConfirmation({ offerId: offer.id, decision })
  }

  const confirming = offers.find((offer) => offer.id === confirmation?.offerId) ?? null
  // An offer that a read or a change made elsewhere takes out of the list while its confirmation is
  // open was decided or withdrawn elsewhere, so the confirmation closes and the page says so. An
  // offer that leaves while the admin's own decision is on its way, or after the server refused it,
  // is that decision's to report.
  const goneElsewhere =
    confirmation !== null &&
    confirming === null &&
    deciding === null &&
    refusal === null &&
    query.data !== undefined &&
    !query.error
  /** The last offer whose confirmation closed because it left the list, until the page says so. */
  const [gone, setGone] = useState<{ offerId: string } | null>(null)
  if (goneElsewhere) {
    setGone({ offerId: confirmation.offerId })
    setConfirmation(null)
  }
  const sayGone = useEffectEvent(() => onDecided(NO_LONGER_WAITING))

  useEffect(() => {
    if (gone) sayGone()
  }, [gone])

  if (query.loading && !query.data) {
    return <ShareOffersLoading />
  }
  if (query.error || !query.data) {
    return <ShareOffersUnavailable error={query.error} onRetry={readAgain} />
  }

  return (
    <>
      {refusal && !confirming && (
        <p className={styles.refusal} role="alert">
          {refusal}
        </p>
      )}
      <div ref={liveList}>
        {offers.length === 0 ? (
          <p className={styles.note}>No share invitations are waiting for {household.name}.</p>
        ) : (
          <SharingSection title={`Share invitations for ${household.name}`} failure={null}>
            <ul className={styles.rows}>
              {offers.map((offer) => (
                <li key={offer.id} className={styles.row}>
                  <SharedProfileText
                    profile={offer.profile}
                    byline={
                      offer.offeredByDisplayName && `Offered by ${offer.offeredByDisplayName}`
                    }
                  >
                    {offer.expiresAt && (
                      <span className={styles.status}>
                        {expiryLabel(offer.expiresAt, new Date())}
                      </span>
                    )}
                  </SharedProfileText>
                  <span className={styles.actions}>
                    <Button
                      variant="filled"
                      aria-label={`Accept ${offeredProfile(offer)}`}
                      disabled={deciding !== null}
                      onClick={() => ask(offer, 'accept')}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="default"
                      aria-label={`Decline ${offeredProfile(offer)}`}
                      disabled={deciding !== null}
                      onClick={() => ask(offer, 'decline')}
                    >
                      Decline
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </SharingSection>
        )}
      </div>
      <ConfirmDialog
        opened={confirming !== null}
        title={
          confirming && confirmation
            ? question(confirming, confirmation.decision, household.name)
            : ''
        }
        body={
          confirming && confirmation
            ? consequence(confirming, confirmation.decision, household.name)
            : ''
        }
        confirmLabel={confirmation?.decision === 'decline' ? 'Decline' : 'Accept'}
        destructive={confirmation?.decision === 'decline'}
        icon={null}
        pending={confirming !== null && deciding === confirming.id}
        disabled={changing}
        error={refusal}
        onClose={() => {
          setConfirmation(null)
          setRefusal(null)
        }}
        onConfirm={() => {
          if (confirming && confirmation) void decide(confirming, confirmation.decision)
        }}
      />
    </>
  )
}

function offeredProfile(offer: PendingOffer): string {
  return offer.profile.name
}

function question(offer: PendingOffer, decision: Decision, household: string): string {
  if (decision === 'decline') return `Decline ${offeredProfile(offer)}?`
  return `Accept ${offeredProfile(offer)} into ${household}?`
}

// A declined offer spent its code, so offering the Profile again takes a new code from this
// Household.
function consequence(offer: PendingOffer, decision: Decision, household: string): string {
  if (decision === 'decline') {
    return `Whoever offered ${offeredProfile(offer)} needs a new share code from ${household} to offer again.`
  }
  return acceptance(offer.profile, household)
}

/** What accepting the offer does, as is true of this Profile. */
function acceptance(profile: OfferedProfile, household: string): string {
  const arrives = profile.personalProfile
    ? `This is someone's Personal Profile. Accepting admits that person to ${household}: they can select any Profile available here, browse its libraries and link a TV to it.`
    : `${profile.name} becomes available in ${household}.`
  if (!profile.restricted) return arrives
  return `${arrives} It is restricted, so admins of ${household} supervise it here.`
}

function ShareOffersLoading() {
  return (
    <Center h={200}>
      <Loader role="status" aria-label="Loading share invitations" />
    </Center>
  )
}

function ShareOffersUnavailable({
  error,
  onRetry,
}: Readonly<{ error: unknown; onRetry: () => unknown }>) {
  return (
    <FailurePanel onRetry={onRetry}>
      {requestFailureMessage(error, "Couldn't load share invitations.")}
    </FailurePanel>
  )
}
