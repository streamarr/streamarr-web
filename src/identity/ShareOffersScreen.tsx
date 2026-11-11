import { Button, Center, Loader } from '@mantine/core'
import { useMutation, useQuery } from '@apollo/client/react'
import { useState, type Ref } from 'react'
import {
  AcceptProfileShareDocument,
  RejectProfileShareDocument,
  ShareOffersDocument,
  type MeQuery,
  type ShareOffersQuery,
} from '../graphql/generated/graphql'
import { useLiveList } from '../graphql/liveList'
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
import {
  keepsInHouseholdShares,
  shareIdOf,
  statusAt,
  withShareChange,
  type ShareChange,
} from './shareLists'
import { SharingSection } from './SharingSection'
import { expiryLabel, UPDATE_FAILED_MESSAGE } from './shareText'
import { useMe } from './useMe'
import { useNow } from './useNow'
import { useShareChanges } from './useShareChanges'

type ListedOffer = ShareOffersQuery['householdShares']['edges'][number]['node']
type OfferedProfile = NonNullable<ListedOffer['profile']>
/** An offer as the page lists it: one whose Profile the server names. */
type PendingOffer = ListedOffer & { profile: OfferedProfile }
type Household = MeQuery['me']['household']
type Decision = 'accept' | 'decline'

/** The offers of Profiles to the Account's Household, which its admins accept or decline. */
export function ShareOffersScreen() {
  const { notice, heading, announce, dismiss } = usePageNotice()
  const liveList = useFocusFallback(heading)

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Share offers
        </h1>
      </div>
      <PageNotice onDismiss={dismiss}>{notice}</PageNotice>
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
  const variables = { householdId: household.id }
  // The offers that the query asks for.
  const list = { householdId: household.id, statuses: ['PENDING'] as const, serverAdmin }
  const liveOffers = useLiveList({
    query: ShareOffersDocument,
    variables,
    keyOf: shareIdOf,
    apply: (data, change: ShareChange) => {
      const edges = withShareChange(data.householdShares.edges, change, (share) =>
        keepsInHouseholdShares(share, list, new Date()),
      )
      return { ...data, householdShares: { ...data.householdShares, edges } }
    },
  })
  useShareChanges(liveOffers.receive)
  // Offers arrive, expire and are withdrawn elsewhere, so a visit shows only the server's answer.
  const query = useQuery(ShareOffersDocument, {
    variables,
    fetchPolicy: 'network-only',
    context: liveOffers.context,
  })
  const [accept] = useMutation(AcceptProfileShareDocument)
  const [decline] = useMutation(RejectProfileShareDocument)
  /** The offer whose acceptance waits for the admin's confirmation. */
  const [confirming, setConfirming] = useState<PendingOffer | null>(null)
  /** The offer whose decision is on its way; no other decision starts until it lands. */
  const [deciding, setDeciding] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  // A failed read keeps the list that is on screen; the query's own error state reports it.
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
      onDecided(`Offer of ${offeredProfile(offer)} declined.`)
    }
  }

  const listed = query.data?.householdShares.edges.map((edge) => edge.node) ?? []
  // An offer leaves the list when its time runs out, as the query would leave it out.
  const now = useNow(listed.map((offer) => offer.expiresAt))

  if (query.loading && !query.data) {
    return <ShareOffersLoading />
  }
  if (query.error || !query.data) {
    return <ShareOffersUnavailable error={query.error} onRetry={readAgain} />
  }

  const offers = listed
    .filter((offer) => statusAt(offer, now) === 'PENDING')
    .filter(namesItsProfile)

  return (
    <>
      {refusal && !confirming && (
        <p className={styles.refusal} role="alert">
          {refusal}
        </p>
      )}
      <div ref={liveList}>
        {offers.length === 0 ? (
          <p className={styles.note}>No one has offered a Profile to {household.name}.</p>
        ) : (
          <SharingSection title={`Profiles offered to ${household.name}`} failure={null}>
            <ul className={styles.rows}>
              {offers.map((offer, index) => (
                <li key={offer.id} className={styles.row}>
                  <SharedProfileText
                    profile={offer.profile}
                    byline={
                      offer.offeredByDisplayName && `Offered by ${offer.offeredByDisplayName}`
                    }
                    paletteIndex={index}
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
      </div>
      <ConfirmDialog
        opened={confirming !== null}
        title={confirming ? `Accept ${offeredProfile(confirming)} into ${household.name}?` : ''}
        body={confirming ? acceptance(confirming.profile, household.name) : ''}
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

function namesItsProfile(offer: ListedOffer): offer is PendingOffer {
  return offer.profile !== null
}

function offeredProfile(offer: PendingOffer): string {
  return offer.profile.name
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
