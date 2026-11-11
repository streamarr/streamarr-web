import { Center, Loader } from '@mantine/core'
import { useApolloClient, useQuery } from '@apollo/client/react'
import { useState } from 'react'
import settingsStyles from '../styles/settings.module.css'
import { ProfileSharesDocument } from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { FailurePanel } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { useFocusFallback } from '../ui/useFocusFallback'
import { usePageNotice } from '../ui/usePageNotice'
import { ArrivingShareCodeContext } from './arrivingShareCode'
import styles from './Sharing.module.css'
import { keepsInProfileShares, withShareChange } from './shareLists'
import { useMe } from './useMe'
import { useShareChanges } from './useShareChanges'
import { WhereShared, type ProfileShareRow } from './WhereShared'

type PersonalProfile = Readonly<{ id: string; name: string }>

/**
 * Where the Account's Personal Profile is shared, and the way to share it with another Household.
 * A share code that the page's link carried opens the share form with it, once.
 */
export function SharingScreen({ arrivingCode = null }: Readonly<{ arrivingCode?: string | null }>) {
  const { notice, heading, announce, dismiss } = usePageNotice()
  useFocusFallback(heading)
  const [code, setCode] = useState(arrivingCode)

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Sharing
        </h1>
      </div>
      <PageNotice onDismiss={dismiss}>{notice}</PageNotice>
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
    <ProfileSharing profile={personal} ownHouseholdName={me.household.name} onChanged={onChanged} />
  )
}

function ProfileSharing({
  profile,
  ownHouseholdName,
  onChanged,
}: Readonly<{
  profile: PersonalProfile
  ownHouseholdName: string
  onChanged: (notice: string) => void
}>) {
  const { cache } = useApolloClient()
  const variables = { profileId: profile.id }
  // The query asks for the Profile's shares at every status.
  useShareChanges((change) =>
    cache.updateQuery({ query: ProfileSharesDocument, variables }, (data) => {
      if (!data) return undefined
      const edges = withShareChange(data.profileShares.edges, change, (share) =>
        keepsInProfileShares(share, variables, new Date()),
      )
      return { ...data, profileShares: { ...data.profileShares, edges } }
    }),
  )
  // Offers are accepted, declined and expire elsewhere, so a visit shows only the server's answer.
  const query = useQuery(ProfileSharesDocument, { variables, fetchPolicy: 'network-only' })
  // A failed read keeps the list that is on screen.
  const readAgain = () => query.refetch().catch(() => undefined)

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
      householdName={householdNamer(shares)}
      ownHouseholdName={ownHouseholdName}
      readAgain={readAgain}
      onChanged={onChanged}
    />
  )
}

/**
 * Names a Household by the name that its shares carry. Everyone who may read a Profile's shares
 * may read that name, so "another Household" stands only for a share that the server sent without
 * one.
 */
function householdNamer(shares: readonly ProfileShareRow[]): (householdId: string) => string {
  const names = new Map(
    shares.flatMap((share) =>
      share.household ? [[share.household.id, share.household.name]] : [],
    ),
  )
  return (householdId) => names.get(householdId) ?? 'another Household'
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
