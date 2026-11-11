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
import { userErrorMessage } from '../graphql/userErrors'
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
import { useConfirmedChange } from './useConfirmedChange'
import { useMe } from './useMe'
import { useNow } from './useNow'
import { useShareChanges } from './useShareChanges'

type ListedOffer = ShareOffersQuery['householdShares']['edges'][number]['node']
type OfferedProfile = NonNullable<ListedOffer['profile']>
/** An offer as the page lists it: one whose Profile the server names. */
type PendingOffer = ListedOffer & { profile: OfferedProfile }
type Household = MeQuery['me']['household']

const NO_LONGER_WAITING = 'That offer is no longer waiting.'

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
  // A failed read keeps the list that is on screen; the query's own error state reports it.
  const readAgain = () => query.refetch().catch(() => undefined)
  const listed = query.data?.householdShares.edges.map((edge) => edge.node) ?? []
  // An offer leaves the list when its time runs out, as the query would leave it out.
  const now = useNow(listed.map((offer) => offer.expiresAt))
  const offers = listed
    .filter((offer) => statusAt(offer, now) === 'PENDING')
    .filter(namesItsProfile)
  const accepting = useConfirmedChange<PendingOffer>({
    send: async (offer) =>
      (await accept({ variables: { input: { shareId: offer.id } } })).data?.acceptProfileShare
        ?.userErrors ?? [],
    readAgain,
    onDone: (offer) => onDecided(`${offeredProfile(offer)} accepted into ${household.name}.`),
    listed: offers,
    onGone: () => onDecided(NO_LONGER_WAITING),
  })
  /** The offer whose decline is on its way; no other decision starts until it lands. */
  const [declining, setDeclining] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const deciding = declining !== null || accepting.sending

  async function declineNow(offer: PendingOffer) {
    setRefusal(null)
    setDeclining(offer.id)
    try {
      const { data } = await decline({ variables: { input: { shareId: offer.id } } })
      const errors = data?.rejectProfileShare?.userErrors ?? []
      if (errors.length > 0) setRefusal(errors.map(userErrorMessage).join(' '))
      // A refused offer may have been decided or withdrawn elsewhere, so the list is read again.
      await readAgain()
      if (errors.length === 0) onDecided(`Offer of ${offeredProfile(offer)} declined.`)
    } catch (error) {
      setRefusal(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
    } finally {
      setDeclining(null)
    }
  }

  if (query.loading && !query.data) {
    return <ShareOffersLoading />
  }
  if (query.error || !query.data) {
    return <ShareOffersUnavailable error={query.error} onRetry={readAgain} />
  }

  return (
    <>
      {refusal && !accepting.pending && (
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
                      disabled={deciding}
                      onClick={() => {
                        setRefusal(null)
                        accepting.ask(offer)
                      }}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="default"
                      aria-label={`Decline ${offeredProfile(offer)}`}
                      loading={declining === offer.id}
                      disabled={deciding}
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
        opened={accepting.pending !== null}
        title={
          accepting.pending
            ? `Accept ${offeredProfile(accepting.pending)} into ${household.name}?`
            : ''
        }
        body={accepting.pending ? acceptance(accepting.pending.profile, household.name) : ''}
        confirmLabel="Accept"
        icon={null}
        pending={accepting.sending}
        error={accepting.refusal}
        onClose={accepting.close}
        onConfirm={accepting.confirmPending}
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
