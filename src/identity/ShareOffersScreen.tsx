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
import { FailurePanel } from '../ui/Failure'
import styles from './Sharing.module.css'
import { SharingSection } from './SharingSection'
import { shortId, UPDATE_FAILED_MESSAGE } from './shareText'
import { useMe } from './useMe'

type PendingOffer = ShareOffersQuery['pendingShareOffers']['edges'][number]['node']
type Household = MeQuery['me']['household']

/** The offers of Profiles to the Account's Household, which its admins accept or reject. */
export function ShareOffersScreen() {
  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1>Share offers</h1>
      </div>
      <ShareOffersContent />
    </>
  )
}

function ShareOffersContent() {
  const me = useMe()

  if (me.loading && !me.data) {
    return <ShareOffersLoading />
  }
  if (me.error || !me.data) {
    return <ShareOffersUnavailable error={me.error} onRetry={me.refetch} />
  }
  return <HouseholdOffers household={me.data.me.household} />
}

function HouseholdOffers({ household }: Readonly<{ household: Household }>) {
  const query = useQuery(ShareOffersDocument, { variables: { householdId: household.id } })
  const refetch = () => query.refetch()

  if (query.loading && !query.data) {
    return <ShareOffersLoading />
  }
  if (query.error || !query.data) {
    return <ShareOffersUnavailable error={query.error} onRetry={refetch} />
  }

  const offers = query.data.pendingShareOffers.edges.map((edge) => edge.node)
  if (offers.length === 0) {
    return <p className={styles.note}>No one has offered a Profile to {household.name}.</p>
  }
  return <Offers householdName={household.name} offers={offers} onDecided={refetch} />
}

function ShareOffersLoading() {
  return (
    <Center h={200}>
      <Loader role="status" aria-label="Loading share offers" />
    </Center>
  )
}

function ShareOffersUnavailable({
  error,
  onRetry,
}: Readonly<{ error: unknown; onRetry: () => unknown }>) {
  return (
    <FailurePanel onRetry={onRetry}>
      {requestFailureMessage(error, "Couldn't load share offers.")}
    </FailurePanel>
  )
}

function Offers({
  householdName,
  offers,
  onDecided,
}: Readonly<{
  householdName: string
  offers: PendingOffer[]
  onDecided: () => void
}>) {
  const [accept] = useMutation(AcceptProfileShareDocument)
  const [reject] = useMutation(RejectProfileShareDocument)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function decide(offer: PendingOffer, decision: 'accept' | 'reject') {
    setFailure(null)
    setBusy(offer.id)
    try {
      await applyDecision(offer, decision)
    } catch (error) {
      setFailure(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
    } finally {
      setBusy(null)
    }
  }

  async function applyDecision(offer: PendingOffer, decision: 'accept' | 'reject') {
    const errors = await sendDecision(offer, decision)
    if (errors?.length) {
      setFailure(userErrorMessage(errors[0]))
      return
    }
    onDecided()
  }

  async function sendDecision(
    offer: PendingOffer,
    decision: 'accept' | 'reject',
  ): Promise<readonly UserErrorLike[] | undefined> {
    const variables = { input: { shareId: offer.id } }
    if (decision === 'accept') {
      return (await accept({ variables })).data?.acceptProfileShare?.userErrors
    }
    return (await reject({ variables })).data?.rejectProfileShare?.userErrors
  }

  return (
    <SharingSection title={`Profiles offered to ${householdName}`} failure={failure}>
      <ul className={styles.rows}>
        {offers.map((offer) => (
          <li key={offer.id} className={styles.row}>
            <span className={styles.rowText}>
              Profile {shortId(offer.profileId)}
              {offer.expiresAt && (
                <span className={styles.status}>
                  Expires {new Date(offer.expiresAt).toLocaleString()}
                </span>
              )}
            </span>
            <span className={styles.actions}>
              <Button loading={busy === offer.id} onClick={() => decide(offer, 'accept')}>
                Accept
              </Button>
              <Button
                variant="default"
                disabled={busy === offer.id}
                onClick={() => decide(offer, 'reject')}
              >
                Reject
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </SharingSection>
  )
}
