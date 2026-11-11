import { Button } from '@mantine/core'
import { useMutation } from '@apollo/client/react'
import { useState, type ReactNode, type Ref } from 'react'
import {
  CancelProfileShareDocument,
  EndProfileShareDocument,
  type ProfileSharesQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage } from '../graphql/userErrors'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { ShareWithAnotherHousehold } from './ShareWithAnotherHousehold'
import { SharingSection } from './SharingSection'
import { expiryLabel, UPDATE_FAILED_MESSAGE } from './shareText'
import styles from './Sharing.module.css'
import { useConfirmedChange } from './useConfirmedChange'

export type ProfileShareRow = ProfileSharesQuery['profileShares']['edges'][number]['node']

/**
 * The Households that a Profile is shared with or offered to, the way to share it with another,
 * and, behind a disclosure, the offers and shares that are over.
 */
export function WhereShared({
  profile,
  shares,
  householdName,
  ownHouseholdName,
  readAgain,
  onChanged,
  liveList,
  earlier,
}: Readonly<{
  profile: Readonly<{ id: string; name: string }>
  /** The offers that wait for a decision and the active shares. */
  shares: readonly ProfileShareRow[]
  householdName: (householdId: string) => string
  /** The Household that the Account is a member of, where its sessions return. */
  ownHouseholdName: string
  readAgain: () => Promise<unknown>
  onChanged: (notice: string) => void
  /** Where focus that a change takes away from a row returns to the page's heading. */
  liveList: Ref<HTMLUListElement>
  /** The offers and shares that are over, behind their disclosure. */
  earlier: ReactNode
}>) {
  const [cancel] = useMutation(CancelProfileShareDocument)
  const [end] = useMutation(EndProfileShareDocument)
  const ending = useConfirmedChange<ProfileShareRow>({
    send: async (share) =>
      (await end({ variables: { input: { shareId: share.id } } })).data?.endProfileShare
        ?.userErrors ?? [],
    readAgain,
    onDone: (share) => onChanged(`Sharing with ${householdName(share.householdId)} ended.`),
    listed: shares,
    // The share has left the list, so its name comes from the row the confirmation kept.
    onGone: (share) =>
      onChanged(
        `Sharing with ${share.household?.name ?? householdName(share.householdId)} has already ended.`,
      ),
  })
  /** The offer whose cancellation is on its way; no other change starts until it lands. */
  const [canceling, setCanceling] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const changing = canceling !== null || ending.sending

  // Canceling an offer loses nothing that a new offer cannot bring back, so it asks nothing.
  async function cancelOffer(share: ProfileShareRow) {
    setRefusal(null)
    setCanceling(share.id)
    try {
      const { data } = await cancel({ variables: { input: { shareId: share.id } } })
      const errors = data?.cancelProfileShare?.userErrors ?? []
      if (errors.length > 0) setRefusal(errors.map(userErrorMessage).join(' '))
      // A refused share may have changed elsewhere, so the list is read again.
      await readAgain()
      if (errors.length === 0) onChanged(`Offer to ${householdName(share.householdId)} canceled.`)
    } catch (error) {
      setRefusal(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
    } finally {
      setCanceling(null)
    }
  }

  return (
    <SharingSection
      title={`Where ${profile.name} is shared`}
      failure={ending.pending ? null : refusal}
    >
      {shares.length === 0 && (
        <p className={styles.note}>{profile.name} is not shared with another Household.</p>
      )}
      <ul ref={liveList} className={styles.rows}>
        {shares.map((share) => {
          const household = householdName(share.householdId)
          const pending = share.status === 'PENDING'
          return (
            <li key={share.id} className={styles.row}>
              <span className={styles.rowText}>
                {household}
                {pending && <span className={styles.status}>Waiting for an admin there</span>}
                {pending && share.expiresAt && (
                  <span className={styles.status}>{expiryLabel(share.expiresAt, new Date())}</span>
                )}
              </span>
              {pending ? (
                <Button
                  variant="default"
                  aria-label={`Cancel offer to ${household}`}
                  loading={canceling === share.id}
                  disabled={changing}
                  onClick={() => void cancelOffer(share)}
                >
                  Cancel offer
                </Button>
              ) : (
                <Button
                  variant="default"
                  aria-label={`End share with ${household}`}
                  disabled={changing}
                  onClick={() => {
                    setRefusal(null)
                    ending.ask(share)
                  }}
                >
                  End share
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <ShareWithAnotherHousehold profile={profile} readAgain={readAgain} onChanged={onChanged} />
      {earlier}
      <ConfirmDialog
        opened={ending.pending !== null}
        title={`End sharing with ${ending.pending ? householdName(ending.pending.householdId) : ''}?`}
        body={
          ending.pending
            ? `${profile.name} stops being available in ${householdName(ending.pending.householdId)}. The TVs you linked there are unlinked, and your sessions there return to ${ownHouseholdName}. Sharing again needs a new offer and an admin there to accept it.`
            : ''
        }
        confirmLabel="End share"
        destructive
        icon={null}
        pending={ending.sending}
        error={ending.refusal}
        onClose={ending.close}
        onConfirm={ending.confirmPending}
      />
    </SharingSection>
  )
}
