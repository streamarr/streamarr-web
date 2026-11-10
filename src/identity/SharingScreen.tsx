import { Alert, Button, Center, Loader, TextInput } from '@mantine/core'
import { useMutation, useQuery } from '@apollo/client/react'
import { useId, useState, type ReactNode } from 'react'
import settingsStyles from '../styles/settings.module.css'
import {
  AcceptProfileShareDocument,
  CancelProfileShareDocument,
  EndProfileShareDocument,
  OfferProfileShareDocument,
  ProfileSharePreviewDocument,
  RejectProfileShareDocument,
  SharingOverviewDocument,
  type SharingOverviewQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { FailurePanel } from '../ui/Failure'
import { enumLabel } from './enumLabel'
import styles from './Sharing.module.css'
import { useMe } from './useMe'

type PendingOffer = SharingOverviewQuery['pendingShareOffers']['edges'][number]['node']
type ProfileShareRow = SharingOverviewQuery['profileShares']['edges'][number]['node']

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UPDATE_FAILED_MESSAGE = "Couldn't update sharing."

export function SharingScreen() {
  return (
    <div className={`${settingsStyles.settings} ${styles.page}`}>
      <div className={settingsStyles.pageHeading}>
        <h1>Sharing</h1>
      </div>
      <SharingContent />
    </div>
  )
}

function SharingContent() {
  const { data: meData, loading: meLoading, error: meError, refetch: refetchMe } = useMe()

  if (meLoading && !meData) {
    return <SharingLoading />
  }

  if (meError || !meData) {
    return <SharingUnavailable error={meError} onRetry={refetchMe} />
  }

  const household = meData.me.contextHousehold
  const personal = meData.me.selectableProfiles.edges
    .map((edge) => edge.node)
    .find((profile) => profile.personal)
  if (!personal) {
    return (
      <p className={styles.note}>You have no Profile of your own in {household.name} to share.</p>
    )
  }

  return (
    <Sharing
      householdId={household.id}
      householdName={household.name}
      profileId={personal.id}
      profileName={personal.name}
    />
  )
}

function Sharing({
  householdId,
  householdName,
  profileId,
  profileName,
}: Readonly<{
  householdId: string
  householdName: string
  profileId: string
  profileName: string
}>) {
  const overview = useQuery(SharingOverviewDocument, {
    variables: { householdId, profileId },
  })
  const refetch = () => overview.refetch()

  if (overview.loading && !overview.data) {
    return <SharingLoading />
  }

  if (overview.error || !overview.data) {
    return <SharingUnavailable error={overview.error} onRetry={refetch} />
  }

  const offers = overview.data.pendingShareOffers.edges.map((edge) => edge.node)
  const shares = overview.data.profileShares.edges.map((edge) => edge.node)

  return (
    <div className={styles.sections}>
      <OffersIntoHousehold householdName={householdName} offers={offers} onDecided={refetch} />
      <OfferForm profileId={profileId} profileName={profileName} onOffered={refetch} />
      <OwnShares
        householdId={householdId}
        profileName={profileName}
        shares={shares}
        onChanged={refetch}
      />
    </div>
  )
}

/** One panel of the page: its title names the region, and a refusal shows under the title. */
function SharingSection({
  title,
  failure,
  children,
}: Readonly<{ title: string; failure: string | null; children: ReactNode }>) {
  const titleId = useId()
  return (
    <section className={`${settingsStyles.formPanel} ${styles.section}`} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.sectionTitle}>
        {title}
      </h2>
      {failure && (
        <Alert color="red" role="alert">
          {failure}
        </Alert>
      )}
      {children}
    </section>
  )
}

function SharingLoading() {
  return (
    <Center h={200}>
      <Loader />
    </Center>
  )
}

function SharingUnavailable({
  error,
  onRetry,
}: Readonly<{ error: unknown; onRetry: () => unknown }>) {
  return (
    <FailurePanel onRetry={onRetry}>
      {requestFailureMessage(error, "Couldn't load sharing.")}
    </FailurePanel>
  )
}

function OffersIntoHousehold({
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

function OfferForm({
  profileId,
  profileName,
  onOffered,
}: Readonly<{
  profileId: string
  profileName: string
  onOffered: () => void
}>) {
  const [householdId, setHouseholdId] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const validTarget = UUID_SHAPE.test(householdId)
  const preview = useQuery(ProfileSharePreviewDocument, {
    variables: { profileId, householdId },
    skip: !validTarget,
  })
  const [offer, { loading }] = useMutation(OfferProfileShareDocument)

  async function submit() {
    setFailure(null)
    try {
      await sendOffer()
    } catch (error) {
      setFailure(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
    }
  }

  async function sendOffer() {
    const result = await offer({ variables: { input: { profileId, householdId } } })
    const errors = result.data?.offerProfileShare?.userErrors
    if (errors?.length) {
      setFailure(userErrorMessage(errors[0]))
      return
    }
    setHouseholdId('')
    onOffered()
  }

  const answers = preview.data?.profileSharePreview

  return (
    <SharingSection title={`Share ${profileName} into another Household`} failure={failure}>
      <TextInput
        label="Household id"
        description="Ask that Household's admin for it"
        value={householdId}
        onChange={(event) => setHouseholdId(event.currentTarget.value.trim())}
      />
      {answers?.wouldLock && (
        <Alert color="yellow">{profileName} would arrive locked there until it gets a PIN.</Alert>
      )}
      {answers?.nameConflict && (
        <Alert color="yellow">Another Profile there already uses this name.</Alert>
      )}
      <Button className={styles.offer} onClick={submit} loading={loading} disabled={!validTarget}>
        Offer share
      </Button>
    </SharingSection>
  )
}

function OwnShares({
  householdId,
  profileName,
  shares,
  onChanged,
}: Readonly<{
  householdId: string
  profileName: string
  shares: ProfileShareRow[]
  onChanged: () => void
}>) {
  const [cancel] = useMutation(CancelProfileShareDocument)
  const [end] = useMutation(EndProfileShareDocument)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function change(share: ProfileShareRow) {
    setFailure(null)
    setBusy(share.id)
    try {
      await applyChange(share)
    } catch (error) {
      setFailure(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
    } finally {
      setBusy(null)
    }
  }

  async function applyChange(share: ProfileShareRow) {
    const errors = await sendChange(share)
    if (errors?.length) {
      setFailure(userErrorMessage(errors[0]))
      return
    }
    onChanged()
  }

  async function sendChange(share: ProfileShareRow): Promise<readonly UserErrorLike[] | undefined> {
    const variables = { input: { shareId: share.id } }
    if (share.status === 'PENDING') {
      return (await cancel({ variables })).data?.cancelProfileShare?.userErrors
    }
    return (await end({ variables })).data?.endProfileShare?.userErrors
  }

  return (
    <SharingSection title={`Where ${profileName} is shared`} failure={failure}>
      {shares.length === 0 && <p className={styles.note}>Nowhere yet.</p>}
      <ul className={styles.rows}>
        {shares.map((share) => (
          <li key={share.id} className={styles.row}>
            <span className={styles.rowText}>
              {share.householdId === householdId
                ? 'This Household'
                : `Household ${shortId(share.householdId)}`}
              <span className={styles.status}>{enumLabel(share.status)}</span>
              {share.requiredByAccountMembership && <span className={styles.status}>Home</span>}
            </span>
            {canChange(share) && (
              <Button variant="default" loading={busy === share.id} onClick={() => change(share)}>
                {share.status === 'PENDING' ? 'Cancel offer' : 'End share'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </SharingSection>
  )
}

function canChange(share: ProfileShareRow): boolean {
  if (share.requiredByAccountMembership) {
    return false
  }
  return share.status === 'PENDING' || share.status === 'ACTIVE'
}

function shortId(id: string): string {
  return id.slice(0, 8)
}
