import { Button, Center, Loader } from '@mantine/core'
import { useMutation } from '@apollo/client/react'
import type { Ref } from 'react'
import {
  AcceptProfileShareDocument,
  RejectProfileShareDocument,
  type MeQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import settingsStyles from '../styles/settings.module.css'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FailurePanel } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { useFocusFallback } from '../ui/useFocusFallback'
import { usePageNotice } from '../ui/usePageNotice'
import styles from './Sharing.module.css'
import { SharedProfileText } from './SharedProfileText'
import { SharingSection } from './SharingSection'
import { expiryLabel } from './shareText'
import { useConfirmedChange } from './useConfirmedChange'
import { useMe } from './useMe'
import { useWaitingOffers, type PendingOffer } from './useWaitingOffers'

type OfferedProfile = PendingOffer['profile']
type Household = MeQuery['me']['household']

const NO_LONGER_WAITING = 'That offer is no longer waiting.'

/** The offers of Profiles to the Account's Household, which its admins accept or decline. */
export function ShareOffersScreen() {
  const { notice, count, heading, announce, dismiss } = usePageNotice()
  const liveList = useFocusFallback(heading)

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Share offers
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
  // A failed read keeps the list that is on screen; the query's own error state reports it.
  const readAgain = () => query.refetch().catch(() => undefined)
  const accepting = useConfirmedChange<PendingOffer>({
    send: async (offer) =>
      (await accept({ variables: { input: { shareId: offer.id } } })).data?.acceptProfileShare
        ?.userErrors ?? [],
    readAgain,
    onDone: (offer) => onDecided(`${offeredProfile(offer)} accepted into ${household.name}.`),
    listed: offers,
    onGone: (_, refusal) => onDecided(refusal ?? NO_LONGER_WAITING),
  })
  // The offer spent its code, so offering the Profile again takes a new code from this Household.
  const declining = useConfirmedChange<PendingOffer>({
    send: async (offer) =>
      (await decline({ variables: { input: { shareId: offer.id } } })).data?.rejectProfileShare
        ?.userErrors ?? [],
    readAgain,
    onDone: (offer) => onDecided(`Offer of ${offeredProfile(offer)} declined.`),
    listed: offers,
    onGone: (_, refusal) => onDecided(refusal ?? NO_LONGER_WAITING),
  })
  const deciding = accepting.sending || declining.sending

  if (query.loading && !query.data) {
    return <ShareOffersLoading />
  }
  if (query.error || !query.data) {
    return <ShareOffersUnavailable error={query.error} onRetry={readAgain} />
  }

  return (
    <>
      <div ref={liveList}>
        {offers.length === 0 ? (
          <p className={styles.note}>No one has offered a Profile to {household.name}.</p>
        ) : (
          <SharingSection title={`Profiles offered to ${household.name}`} failure={null}>
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
                      disabled={deciding}
                      onClick={() => accepting.ask(offer)}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="default"
                      aria-label={`Decline ${offeredProfile(offer)}`}
                      disabled={deciding}
                      onClick={() => declining.ask(offer)}
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
      <ConfirmDialog
        opened={declining.pending !== null}
        title={declining.pending ? `Decline ${offeredProfile(declining.pending)}?` : ''}
        body={
          declining.pending
            ? `Whoever offered ${offeredProfile(declining.pending)} needs a new share code from ${household.name} to offer again.`
            : ''
        }
        confirmLabel="Decline"
        destructive
        icon={null}
        pending={declining.sending}
        error={declining.refusal}
        onClose={declining.close}
        onConfirm={declining.confirmPending}
      />
    </>
  )
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
