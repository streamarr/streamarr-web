import { Button, Center, Loader } from '@mantine/core'
import { useMutation, useQuery } from '@apollo/client/react'
import { useState } from 'react'
import {
  AcceptProfileShareDocument,
  RejectProfileShareDocument,
  ShareOffersDocument,
  type MeQuery,
  type ShareOffersQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import settingsStyles from '../styles/settings.module.css'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FailurePanel } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { usePageNotice } from '../ui/usePageNotice'
import styles from './Sharing.module.css'
import { SharingSection } from './SharingSection'
import { expiryLabel, shortId, UPDATE_FAILED_MESSAGE } from './shareText'
import { useMe } from './useMe'

type PendingOffer = ShareOffersQuery['pendingShareOffers']['edges'][number]['node']
type Household = MeQuery['me']['household']
type Decision = 'accept' | 'decline'

/** The offers of Profiles to the Account's Household, which its admins accept or decline. */
export function ShareOffersScreen() {
  const { notice, count, heading, announce, dismiss } = usePageNotice()

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
      <ShareOffersContent onDecided={announce} />
    </>
  )
}

function ShareOffersContent({ onDecided }: Readonly<{ onDecided: (notice: string) => void }>) {
  const me = useMe()

  if (me.loading && !me.data) {
    return <ShareOffersLoading />
  }
  if (me.error || !me.data) {
    return <ShareOffersUnavailable error={me.error} onRetry={me.refetch} />
  }
  return <HouseholdOffers household={me.data.me.household} onDecided={onDecided} />
}

function HouseholdOffers({
  household,
  onDecided,
}: Readonly<{ household: Household; onDecided: (notice: string) => void }>) {
  // Offers arrive, expire and are withdrawn elsewhere, so a visit shows only the server's answer.
  const query = useQuery(ShareOffersDocument, {
    variables: { householdId: household.id },
    fetchPolicy: 'network-only',
  })
  const [accept] = useMutation(AcceptProfileShareDocument)
  const [decline] = useMutation(RejectProfileShareDocument)
  /** The offer whose acceptance waits for the admin's confirmation. */
  const [confirming, setConfirming] = useState<PendingOffer | null>(null)
  /** The offer whose decision is on its way; no other decision starts until it lands. */
  const [deciding, setDeciding] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  // The query keeps a failed read, and the page shows it in place of the list. Rejecting here
  // would report the decision that the read follows as failed.
  const readAgain = () => query.refetch().catch(() => undefined)

  /** Sends the decision and reads the offers again; resolves to whether the server took it. */
  async function decide(offer: PendingOffer, decision: Decision): Promise<boolean> {
    setRefusal(null)
    setDeciding(offer.id)
    try {
      const errors = await send(offer, decision)
      if (errors?.length) {
        setRefusal(errors.map(userErrorMessage).join(' '))
      }
      // A refused offer may have been decided or withdrawn elsewhere, so the list is read again.
      await readAgain()
      return !errors?.length
    } catch (error) {
      setRefusal(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
      return false
    } finally {
      setDeciding(null)
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

  async function confirmAccept(offer: PendingOffer) {
    if (await decide(offer, 'accept')) {
      setConfirming(null)
      onDecided(`${offeredProfile(offer)} accepted into ${household.name}.`)
    }
  }

  async function declineNow(offer: PendingOffer) {
    if (await decide(offer, 'decline')) {
      onDecided(`Share invitation for ${offeredProfile(offer)} declined.`)
    }
  }

  if (query.loading && !query.data) {
    return <ShareOffersLoading />
  }
  if (query.error || !query.data) {
    return <ShareOffersUnavailable error={query.error} onRetry={readAgain} />
  }

  const offers = query.data.pendingShareOffers.edges.map((edge) => edge.node)

  return (
    <>
      {refusal && !confirming && (
        <p className={styles.refusal} role="alert">
          {refusal}
        </p>
      )}
      {offers.length === 0 ? (
        <p className={styles.note}>No share invitations are waiting for {household.name}.</p>
      ) : (
        <SharingSection title={`Share invitations for ${household.name}`} failure={null}>
          <ul className={styles.rows}>
            {offers.map((offer) => (
              <li key={offer.id} className={styles.row}>
                <span className={styles.rowText}>
                  {offeredProfile(offer)}
                  {offer.expiresAt && (
                    <span className={styles.status}>
                      {expiryLabel(offer.expiresAt, new Date())}
                    </span>
                  )}
                </span>
                <span className={styles.actions}>
                  <Button
                    variant="filled"
                    aria-label={`Accept ${offeredProfile(offer)}`}
                    disabled={deciding !== null}
                    onClick={() => {
                      setRefusal(null)
                      setConfirming(offer)
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="default"
                    aria-label={`Decline ${offeredProfile(offer)}`}
                    loading={deciding === offer.id && !confirming}
                    disabled={deciding !== null}
                    onClick={() => void declineNow(offer)}
                  >
                    Decline
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </SharingSection>
      )}
      <ConfirmDialog
        opened={confirming !== null}
        title={`Accept this Profile into ${household.name}?`}
        body={`If this is someone's Personal Profile, accepting admits that person to ${household.name}. They can select any Profile available here, browse its libraries and link a TV to it.`}
        confirmLabel="Accept"
        icon={null}
        pending={confirming !== null && deciding === confirming.id}
        error={refusal}
        onClose={() => {
          setConfirming(null)
          setRefusal(null)
        }}
        onConfirm={() => {
          if (confirming) void confirmAccept(confirming)
        }}
      />
    </>
  )
}

// The server gives a share no name for its Profile yet, so the start of its id stands for it.
function offeredProfile(offer: PendingOffer): string {
  return `Profile ${shortId(offer.profileId)}`
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
