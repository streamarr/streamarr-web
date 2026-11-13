import { Center, Loader } from '@mantine/core'
import { useQuery } from '@apollo/client/react'
import { useState } from 'react'
import settingsStyles from '../styles/settings.module.css'
import { ProfileSharesDocument, type MeQuery } from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { FailurePanel } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { usePageNotice } from '../ui/usePageNotice'
import { shortId } from './shareText'
import styles from './Sharing.module.css'
import { useMe } from './useMe'
import { WhereShared, type ProfileShareRow } from './WhereShared'

type Me = MeQuery['me']
type PersonalProfile = Readonly<{ id: string; name: string }>

/** Where the Account's Personal Profile is shared, and the way to share it with another Household. */
export function SharingScreen() {
  const { notice, heading, announce, dismiss } = usePageNotice()

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Sharing
        </h1>
      </div>
      <PageNotice onDismiss={dismiss}>{notice}</PageNotice>
      <SharingContent onChanged={announce} />
    </>
  )
}

function SharingContent({ onChanged }: Readonly<{ onChanged: (notice: string) => void }>) {
  const { data: meData, loading: meLoading, error: meError, refetch: refetchMe } = useMe()

  if (meLoading && !meData) {
    return <SharingLoading />
  }

  if (meError || !meData) {
    return <SharingUnavailable error={meError} onRetry={refetchMe} />
  }

  const me = meData.me
  const personal = me.selectableProfiles.edges
    .map((edge) => edge.node)
    .find((profile) => profile.personal)
  if (!personal) {
    return (
      <p className={styles.note}>
        You have no Profile of your own in {me.contextHousehold.name} to share.
      </p>
    )
  }

  return (
    <ProfileSharing
      profile={personal}
      householdName={householdNamer(me)}
      ownHouseholdName={me.household.name}
      onChanged={onChanged}
    />
  )
}

/**
 * Names a Household by its id. A share carries only the id, so the name is known only for a
 * Household that the Account may use; the start of the id stands for any other.
 */
function householdNamer(me: Me): (householdId: string) => string {
  const known = [
    me.household,
    me.contextHousehold,
    ...me.usableHouseholds.edges.map((edge) => edge.node.household),
  ]
  const names = new Map(known.map((household) => [household.id, household.name]))
  return (householdId) => names.get(householdId) ?? `Household ${shortId(householdId)}`
}

function ProfileSharing({
  profile,
  householdName,
  ownHouseholdName,
  onChanged,
}: Readonly<{
  profile: PersonalProfile
  householdName: (householdId: string) => string
  ownHouseholdName: string
  onChanged: (notice: string) => void
}>) {
  // Offers are accepted, declined and expire elsewhere, so a visit shows only the server's answer.
  const query = useQuery(ProfileSharesDocument, {
    variables: { profileId: profile.id },
    fetchPolicy: 'network-only',
  })
  // The query keeps a failed read, and the page shows it in place of the list. Rejecting here
  // would report the change that the read follows as failed.
  const readAgain = () => query.refetch().catch(() => undefined)
  // A change on its way, its refusal, and the confirmation that it belongs to outlast the list
  // that a failed read takes off the page, so they are held here and not in the list.
  const [changing, setChanging] = useState<string | null>(null)
  const [ending, setEnding] = useState<ProfileShareRow | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  if (query.loading && !query.data) {
    return <SharingLoading />
  }

  if (query.error || !query.data) {
    return <SharingUnavailable error={query.error} onRetry={readAgain} />
  }

  // Every Personal Profile is shared with its Account's own Household, and that share cannot
  // end, so it is no news here.
  const shares = query.data.profileShares.edges
    .map((edge) => edge.node)
    .filter((share) => !share.requiredByAccountMembership)

  return (
    <WhereShared
      profile={profile}
      shares={shares}
      householdName={householdName}
      ownHouseholdName={ownHouseholdName}
      readAgain={readAgain}
      onChanged={onChanged}
      changing={changing}
      onChangingChange={setChanging}
      ending={ending}
      onEndingChange={setEnding}
      refusal={refusal}
      onRefusalChange={setRefusal}
    />
  )
}

function SharingLoading() {
  return (
    <Center h={200}>
      <Loader role="status" aria-label="Loading sharing" />
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
