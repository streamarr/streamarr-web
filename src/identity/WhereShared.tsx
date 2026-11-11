import { Button } from '@mantine/core'
import { useMutation } from '@apollo/client/react'
import { useEffect, useEffectEvent, useRef, type ReactNode, type Ref } from 'react'
import {
  CancelProfileShareDocument,
  EndProfileShareDocument,
  type ProfileSharesQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FailureRow } from '../ui/Failure'
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
  readFailure,
  readAgain,
  onChanged,
  changing,
  onChangingChange,
  ending,
  onEndingChange,
  canceling,
  onCancelingChange,
  refusal,
  onRefusalChange,
  liveList,
  earlier,
}: Readonly<{
  profile: Readonly<{ id: string; name: string }>
  /** The offers that wait for a decision and the active shares. */
  shares: readonly ProfileShareRow[]
  householdName: (householdId: string) => string
  /** The Household that the Account is a member of, where its sessions return. */
  ownHouseholdName: string
  /** Why the latest read of `shares` failed, or null when it did not. */
  readFailure: string | null
  readAgain: () => Promise<unknown>
  onChanged: (notice: string) => void
  /** The share whose change is on its way; no other change starts until it lands. */
  changing: string | null
  onChangingChange: (shareId: string | null) => void
  /** The share whose end waits for the person's confirmation. */
  ending: ProfileShareRow | null
  onEndingChange: (share: ProfileShareRow | null) => void
  /** The offer whose cancel waits for the person's confirmation. */
  canceling: ProfileShareRow | null
  onCancelingChange: (share: ProfileShareRow | null) => void
  /** The server's words for a change that it refused. */
  refusal: string | null
  onRefusalChange: (refusal: string | null) => void
  /** Where focus that a change takes away from a row returns to the page's heading. */
  liveList: Ref<HTMLUListElement>
  /** The offers and shares that are over, behind their disclosure. */
  earlier: ReactNode
}>) {
  const [cancel] = useMutation(CancelProfileShareDocument)
  const [end] = useMutation(EndProfileShareDocument)
  /** Each live share's action, where focus returns when its confirmation closes. */
  const rowActions = useRef(new Map<string, HTMLButtonElement | null>())
  /** Where focus goes when the confirmation closes after its share's action is gone. */
  const heading = useRef<HTMLHeadingElement>(null)

  // A share that a read or a change made elsewhere takes out of the list while its confirmation is
  // open has ended there, so the confirmation closes and the page says so. A share that leaves while
  // the person's own change is on its way, or after the server refused it, is that change's to report.
  const endedElsewhere =
    ending !== null &&
    changing === null &&
    refusal === null &&
    !shares.some((share) => share.id === ending.id)
  const sayEnded = useEffectEvent(() => {
    if (!ending) return
    onEndingChange(null)
    // The share has left the list, so its name comes from the row the confirmation kept.
    onChanged(
      `Sharing with ${ending.household?.name ?? householdName(ending.householdId)} has already ended.`,
    )
  })

  useEffect(() => {
    if (endedElsewhere) sayEnded()
  }, [endedElsewhere])

  // An offer that is accepted, canceled or runs out elsewhere while its confirmation is open no
  // longer waits, so the confirmation closes and the page says so.
  const canceledElsewhere =
    canceling !== null &&
    changing === null &&
    refusal === null &&
    !shares.some((share) => share.id === canceling.id && share.status === 'PENDING')
  const sayNoLongerWaiting = useEffectEvent(() => {
    if (!canceling) return
    onCancelingChange(null)
    onChanged(
      `The offer to ${canceling.household?.name ?? householdName(canceling.householdId)} is no longer waiting.`,
    )
  })

  useEffect(() => {
    if (canceledElsewhere) sayNoLongerWaiting()
  }, [canceledElsewhere])

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

  async function cancelOffer(share: ProfileShareRow) {
    if (await change(share)) {
      onCancelingChange(null)
      onChanged(`Invitation to ${householdName(share.householdId)} canceled.`)
    }
  }

  function ask(share: ProfileShareRow, confirm: (share: ProfileShareRow) => void) {
    onRefusalChange(null)
    confirm(share)
  }

  function rowAction(shareId: string) {
    return (button: HTMLButtonElement | null) => {
      rowActions.current.set(shareId, button)
      return () => {
        rowActions.current.delete(shareId)
      }
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
      failure={ending || canceling ? null : refusal}
      heading={heading}
    >
      {readFailure && <FailureRow onRetry={readAgain}>{readFailure}</FailureRow>}
      {shares.length === 0 && (
        <p className={styles.note}>{profile.name}'s Profile isn't shared with another Household.</p>
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
                  ref={rowAction(share.id)}
                  variant="default"
                  aria-label={`Cancel invitation to ${household}`}
                  disabled={changing !== null}
                  onClick={() => ask(share, onCancelingChange)}
                >
                  Cancel invitation
                </Button>
              ) : (
                <Button
                  ref={rowAction(share.id)}
                  variant="default"
                  aria-label={`End share with ${household}`}
                  disabled={changing !== null}
                  onClick={() => ask(share, onEndingChange)}
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
      {earlier}
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
          // dialog knows nothing to return focus to. A share that ended meanwhile has no action
          // left to return to.
          if (ending) (rowActions.current.get(ending.id) ?? heading.current)?.focus()
          onEndingChange(null)
          onRefusalChange(null)
        }}
        onConfirm={() => {
          if (ending) void endShare(ending)
        }}
      />
      {/* The offer spent its share code, which stays spent: offering again takes a new one. */}
      <ConfirmDialog
        opened={canceling !== null}
        title={`Cancel the offer to ${canceling ? householdName(canceling.householdId) : ''}?`}
        body={
          canceling
            ? `To offer ${profile.name} again you need a new share code from ${householdName(canceling.householdId)}.`
            : ''
        }
        confirmLabel="Cancel invitation"
        destructive
        icon={null}
        pending={canceling !== null && changing === canceling.id}
        error={refusal}
        onClose={() => {
          if (canceling) (rowActions.current.get(canceling.id) ?? heading.current)?.focus()
          onCancelingChange(null)
          onRefusalChange(null)
        }}
        onConfirm={() => {
          if (canceling) void cancelOffer(canceling)
        }}
      />
    </SharingSection>
  )
}
