import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useMutation, useQuery } from '@apollo/client/react'
import { useState } from 'react'
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
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { useMe } from './useMe'

type PendingOffer = SharingOverviewQuery['pendingShareOffers']['edges'][number]['node']
type ProfileShareRow = SharingOverviewQuery['profileShares']['edges'][number]['node']

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FAILURE_MESSAGE = 'Something went wrong. Please try again.'

export function SharingScreen() {
  const { data: meData, loading: meLoading, error: meError } = useMe()

  if (meLoading) {
    return <SharingLoading />
  }

  const personal = meData?.me.selectableProfiles.edges
    .map((edge) => edge.node)
    .find((profile) => profile.personal)
  if (meError || !meData || !personal) {
    return <SharingUnavailable />
  }

  return (
    <Sharing
      householdId={meData.me.contextHousehold.id}
      householdName={meData.me.contextHousehold.name}
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
}: {
  householdId: string
  householdName: string
  profileId: string
  profileName: string
}) {
  const overview = useQuery(SharingOverviewDocument, {
    variables: { householdId, profileId },
  })
  const refetch = () => overview.refetch()

  if (overview.loading) {
    return <SharingLoading />
  }

  if (overview.error || !overview.data) {
    return <SharingUnavailable />
  }

  const offers = overview.data.pendingShareOffers.edges.map((edge) => edge.node)
  const shares = overview.data.profileShares.edges.map((edge) => edge.node)

  return (
    <Stack>
      <Title order={2}>Sharing</Title>
      <OffersIntoHousehold householdName={householdName} offers={offers} onDecided={refetch} />
      <OfferForm profileId={profileId} profileName={profileName} onOffered={refetch} />
      <OwnShares
        householdId={householdId}
        profileName={profileName}
        shares={shares}
        onChanged={refetch}
      />
    </Stack>
  )
}

function SharingLoading() {
  return (
    <Center h={200}>
      <Loader />
    </Center>
  )
}

function SharingUnavailable() {
  return (
    <Alert color="red" role="alert">
      Couldn't load sharing. Try again.
    </Alert>
  )
}

function OffersIntoHousehold({
  householdName,
  offers,
  onDecided,
}: {
  householdName: string
  offers: PendingOffer[]
  onDecided: () => void
}) {
  const [accept] = useMutation(AcceptProfileShareDocument)
  const [reject] = useMutation(RejectProfileShareDocument)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function decide(offer: PendingOffer, decision: 'accept' | 'reject') {
    setFailure(null)
    setBusy(offer.id)
    try {
      await applyDecision(offer, decision)
    } catch {
      setFailure(FAILURE_MESSAGE)
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
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>Offers into {householdName}</Text>
        {failure && (
          <Alert color="red" role="alert">
            {failure}
          </Alert>
        )}
        {offers.length === 0 && <Text c="dimmed">No pending offers.</Text>}
        {offers.map((offer) => (
          <Group key={offer.id} justify="space-between">
            <Text size="sm">
              Profile {shortId(offer.profileId)}
              {offer.expiresAt ? ` · expires ${new Date(offer.expiresAt).toLocaleString()}` : ''}
            </Text>
            <Group gap="xs">
              <Button size="xs" loading={busy === offer.id} onClick={() => decide(offer, 'accept')}>
                Accept
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="red"
                disabled={busy === offer.id}
                onClick={() => decide(offer, 'reject')}
              >
                Reject
              </Button>
            </Group>
          </Group>
        ))}
      </Stack>
    </Card>
  )
}

function OfferForm({
  profileId,
  profileName,
  onOffered,
}: {
  profileId: string
  profileName: string
  onOffered: () => void
}) {
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
    } catch {
      setFailure(FAILURE_MESSAGE)
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
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>Share {profileName} into another Household</Text>
        {failure && (
          <Alert color="red" role="alert">
            {failure}
          </Alert>
        )}
        <TextInput
          label="Household id"
          description="Ask that Household's admin for it"
          value={householdId}
          onChange={(event) => setHouseholdId(event.currentTarget.value.trim())}
        />
        {answers?.wouldLock && (
          <Alert color="yellow">
            {profileName} would arrive locked there until it gets a PIN.
          </Alert>
        )}
        {answers?.nameConflict && (
          <Alert color="yellow">Another Profile there already uses this name.</Alert>
        )}
        <Button onClick={submit} loading={loading} disabled={!validTarget}>
          Offer share
        </Button>
      </Stack>
    </Card>
  )
}

function OwnShares({
  householdId,
  profileName,
  shares,
  onChanged,
}: {
  householdId: string
  profileName: string
  shares: ProfileShareRow[]
  onChanged: () => void
}) {
  const [cancel] = useMutation(CancelProfileShareDocument)
  const [end] = useMutation(EndProfileShareDocument)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function change(share: ProfileShareRow) {
    setFailure(null)
    setBusy(share.id)
    try {
      await applyChange(share)
    } catch {
      setFailure(FAILURE_MESSAGE)
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

  async function sendChange(
    share: ProfileShareRow,
  ): Promise<readonly UserErrorLike[] | undefined> {
    const variables = { input: { shareId: share.id } }
    if (share.status === 'PENDING') {
      return (await cancel({ variables })).data?.cancelProfileShare?.userErrors
    }
    return (await end({ variables })).data?.endProfileShare?.userErrors
  }

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>Where {profileName} is shared</Text>
        {failure && (
          <Alert color="red" role="alert">
            {failure}
          </Alert>
        )}
        {shares.length === 0 && <Text c="dimmed">Nowhere yet.</Text>}
        {shares.map((share) => (
          <Group key={share.id} justify="space-between">
            <Group gap="xs">
              <Text size="sm">
                {share.householdId === householdId
                  ? 'This Household'
                  : `Household ${shortId(share.householdId)}`}
              </Text>
              <Badge variant="light">{share.status}</Badge>
              {share.requiredByAccountMembership && <Badge color="blue">Home</Badge>}
            </Group>
            {canChange(share) && (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                loading={busy === share.id}
                onClick={() => change(share)}
              >
                {share.status === 'PENDING' ? 'Cancel offer' : 'End share'}
              </Button>
            )}
          </Group>
        ))}
      </Stack>
    </Card>
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
