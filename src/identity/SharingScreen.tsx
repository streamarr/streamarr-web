import { Center, Loader } from '@mantine/core'
import { useApolloClient, useQuery } from '@apollo/client/react'
import { useState } from 'react'
import settingsStyles from '../styles/settings.module.css'
import {
  ProfileSharesDocument,
  type MeQuery,
  type ProfileSharesQuery,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { FailurePanel } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { usePageNotice } from '../ui/usePageNotice'
import { ArrivingShareCodeContext } from './arrivingShareCode'
import { shortId } from './shareText'
import styles from './Sharing.module.css'
import { useMe } from './useMe'
import { WhereShared, type ProfileShareRow } from './WhereShared'

type Me = MeQuery['me']
type PersonalProfile = Readonly<{ id: string; name: string }>

/**
 * Where the Account's Personal Profile is shared, and the way to share it with another Household.
 * A share code that the page's link carried opens the share form with it, once.
 */
export function SharingScreen({ arrivingCode = null }: Readonly<{ arrivingCode?: string | null }>) {
  const { notice, count, heading, announce, dismiss } = usePageNotice()
  const [code, setCode] = useState(arrivingCode)

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Sharing
        </h1>
      </div>
      <PageNotice count={count} onDismiss={dismiss}>
        {notice}
      </PageNotice>
      <ArrivingShareCodeContext value={{ code, take: () => setCode(null) }}>
        <SharingContent onChanged={announce} />
      </ArrivingShareCodeContext>
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
  const client = useApolloClient()
  const variables = { profileId: profile.id }
  // Offers are accepted, declined and expire elsewhere, so a visit shows only the server's answer.
  const query = useQuery(ProfileSharesDocument, { variables, fetchPolicy: 'network-only' })
  // The query keeps a failed read, and the page shows it in place of the list. Rejecting here
  // would report the change that the read follows as failed.
  const readAgain = () => query.refetch().catch(() => undefined)
  // A read apart from the page's own, whose failure leaves the page as it is.
  const readShares = () =>
    client
      .query({ query: ProfileSharesDocument, variables, fetchPolicy: 'network-only' })
      .then(({ data }) => (data ? listedShares(data) : undefined))
      .catch(() => undefined)
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

  return (
    <WhereShared
      profile={profile}
      shares={listedShares(query.data)}
      householdName={householdName}
      ownHouseholdName={ownHouseholdName}
      readAgain={readAgain}
      readShares={readShares}
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

// Every Personal Profile is shared with its Account's own Household, and that share cannot end,
// so it is no news here.
function listedShares(data: ProfileSharesQuery): ProfileShareRow[] {
  return data.profileShares.edges
    .map((edge) => edge.node)
    .filter((share) => !share.requiredByAccountMembership)
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
