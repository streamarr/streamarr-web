import { Alert, Button, Center, Loader, TextInput } from '@mantine/core'
import { useMutation, useQuery } from '@apollo/client/react'
import { useState } from 'react'
import settingsStyles from '../styles/settings.module.css'
import {
  CancelProfileShareDocument,
  EndProfileShareDocument,
  OfferProfileShareDocument,
  ProfileSharePreviewDocument,
  SharingOverviewDocument,
  type SharingOverviewQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { FailurePanel } from '../ui/Failure'
import { enumLabel } from './enumLabel'
import { ShareOffers } from './ShareOffers'
import { SharingSection } from './SharingSection'
import { shortId, UPDATE_FAILED_MESSAGE } from './shareText'
import styles from './Sharing.module.css'
import { useMe } from './useMe'

type ProfileShareRow = SharingOverviewQuery['profileShares']['edges'][number]['node']

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function SharingScreen() {
  return (
    <div className={styles.page}>
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
      <ShareOffers householdName={householdName} offers={offers} onDecided={refetch} />
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
