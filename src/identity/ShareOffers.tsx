import { Button } from '@mantine/core'
import { useMutation } from '@apollo/client/react'
import { useState } from 'react'
import {
  AcceptProfileShareDocument,
  RejectProfileShareDocument,
  type SharingOverviewQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import styles from './Sharing.module.css'
import { SharingSection } from './SharingSection'
import { shortId, UPDATE_FAILED_MESSAGE } from './shareText'

type PendingOffer = SharingOverviewQuery['pendingShareOffers']['edges'][number]['node']

/** The offers of Profiles to a Household, which its admins accept or reject. */
export function ShareOffers({
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
    <SharingSection title={`Offers into ${householdName}`} failure={failure}>
      {offers.length === 0 && <p className={styles.note}>No pending offers.</p>}
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
