import { Button } from '@mantine/core'
import { useMutation } from '@apollo/client/react'
import { useRef } from 'react'
import {
  CancelProfileShareDocument,
  EndProfileShareDocument,
  type ProfileSharesQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EarlierShares } from './EarlierShares'
import { ShareWithAnotherHousehold } from './ShareWithAnotherHousehold'
import { SharingSection } from './SharingSection'
import { expiryLabel, UPDATE_FAILED_MESSAGE } from './shareText'
import styles from './Sharing.module.css'

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
  changing,
  onChangingChange,
  ending,
  onEndingChange,
  refusal,
  onRefusalChange,
}: Readonly<{
  profile: Readonly<{ id: string; name: string }>
  shares: readonly ProfileShareRow[]
  householdName: (householdId: string) => string
  /** The Household that the Account is a member of, where its sessions return. */
  ownHouseholdName: string
  readAgain: () => Promise<unknown>
  onChanged: (notice: string) => void
  /** The share whose change is on its way; no other change starts until it lands. */
  changing: string | null
  onChangingChange: (shareId: string | null) => void
  /** The share whose end waits for the person's confirmation. */
  ending: ProfileShareRow | null
  onEndingChange: (share: ProfileShareRow | null) => void
  /** The server's words for a change that it refused. */
  refusal: string | null
  onRefusalChange: (refusal: string | null) => void
}>) {
  const [cancel] = useMutation(CancelProfileShareDocument)
  const [end] = useMutation(EndProfileShareDocument)
  /** Each live share's End action, where focus returns when its confirmation closes. */
  const endActions = useRef(new Map<string, HTMLButtonElement | null>())
  /** Where focus goes when the confirmation closes after its share's End action is gone. */
  const heading = useRef<HTMLHeadingElement>(null)

  const live = shares.filter(isLive)
  const earlier = shares.filter((share) => !isLive(share))

  /** Sends the change and reads the shares again; resolves to whether the server took it. */
  async function change(share: ProfileShareRow): Promise<boolean> {
    onRefusalChange(null)
    onChangingChange(share.id)
    try {
      const errors = await send(share)
      if (errors?.length) {
        onRefusalChange(errors.map(userErrorMessage).join(' '))
      }
      // A refused share may have changed elsewhere, so the list is read again.
      await readAgain()
      return !errors?.length
    } catch (error) {
      onRefusalChange(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
      return false
    } finally {
      onChangingChange(null)
    }
  }

  async function send(share: ProfileShareRow): Promise<readonly UserErrorLike[] | undefined> {
    const variables = { input: { shareId: share.id } }
    if (share.status === 'PENDING') {
      return (await cancel({ variables })).data?.cancelProfileShare?.userErrors
    }
    return (await end({ variables })).data?.endProfileShare?.userErrors
  }

  // Canceling an offer loses nothing that a new offer cannot bring back, so it asks nothing.
  async function cancelOffer(share: ProfileShareRow) {
    if (await change(share)) {
      onChanged(`Invitation to ${householdName(share.householdId)} canceled.`)
    }
  }

  async function endShare(share: ProfileShareRow) {
    if (await change(share)) {
      onEndingChange(null)
      onChanged(`Sharing with ${householdName(share.householdId)} ended.`)
    }
  }

  return (
    <SharingSection
      title={`Where ${profile.name}'s Profile is shared`}
      failure={ending ? null : refusal}
      heading={heading}
    >
      {live.length === 0 && (
        <p className={styles.note}>{profile.name}'s Profile isn't shared with another Household.</p>
      )}
      <ul className={styles.rows}>
        {live.map((share) => {
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
                  aria-label={`Cancel invitation to ${household}`}
                  loading={changing === share.id}
                  disabled={changing !== null}
                  onClick={() => void cancelOffer(share)}
                >
                  Cancel invitation
                </Button>
              ) : (
                <Button
                  ref={(button) => {
                    endActions.current.set(share.id, button)
                    return () => {
                      endActions.current.delete(share.id)
                    }
                  }}
                  variant="default"
                  aria-label={`End share with ${household}`}
                  disabled={changing !== null}
                  onClick={() => {
                    onRefusalChange(null)
                    onEndingChange(share)
                  }}
                >
                  End share
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      <ShareWithAnotherHousehold
        profile={profile}
        readAgain={readAgain}
        onSend={() => onRefusalChange(null)}
        onChanged={onChanged}
      />
      <EarlierShares shares={earlier} householdName={householdName} />
      <ConfirmDialog
        opened={ending !== null}
        title={`End sharing with ${ending ? householdName(ending.householdId) : ''}?`}
        body={
          ending
            ? `${profile.name}'s Profile stops being available in ${householdName(ending.householdId)}. The TVs you linked there are unlinked, and your sessions there return to ${ownHouseholdName}. To share ${profile.name}'s Profile with ${householdName(ending.householdId)} again, send a new invitation. An admin there must accept it.`
            : ''
        }
        confirmLabel="End share"
        destructive
        icon={null}
        pending={ending !== null && changing === ending.id}
        error={refusal}
        onClose={() => {
          // A confirmation that Retry brought back opened without the person's click, so the
          // dialog knows nothing to return focus to. A share that ended meanwhile has no End
          // action left to return to.
          if (ending) (endActions.current.get(ending.id) ?? heading.current)?.focus()
          onEndingChange(null)
          onRefusalChange(null)
        }}
        onConfirm={() => {
          if (ending) void endShare(ending)
        }}
      />
    </SharingSection>
  )
}

function isLive(share: ProfileShareRow): boolean {
  return share.status === 'PENDING' || share.status === 'ACTIVE'
}
