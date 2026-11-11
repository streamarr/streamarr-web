import { Center, Loader } from '@mantine/core'
import { useQuery } from '@apollo/client/react'
import { useState, type Ref } from 'react'
import settingsStyles from '../styles/settings.module.css'
import { ProfileSharesDocument } from '../graphql/generated/graphql'
import { useLiveList } from '../graphql/liveList'
import { requestFailureMessage } from '../graphql/requestErrors'
import { FailurePanel } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { useFocusFallback } from '../ui/useFocusFallback'
import { usePageNotice } from '../ui/usePageNotice'
import { ArrivingShareCodeContext } from './arrivingShareCode'
import styles from './Sharing.module.css'
import {
  keepsInProfileShares,
  shareIdOf,
  statusAt,
  withShareChange,
  type ShareChange,
} from './shareLists'
import { useMe } from './useMe'
import { useNow } from './useNow'
import { useShareChanges } from './useShareChanges'
import { WhereShared, type ProfileShareRow } from './WhereShared'

type PersonalProfile = Readonly<{ id: string; name: string }>

/**
 * Where the Account's Personal Profile is shared, and the way to share it with another Household.
 * A share code that the page's link carried opens the share form with it, once.
 */
export function SharingScreen({ arrivingCode = null }: Readonly<{ arrivingCode?: string | null }>) {
  const { notice, heading, announce, dismiss } = usePageNotice()
  const liveList = useFocusFallback(heading)
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
        <SharingContent onChanged={announce} liveList={liveList} />
      </ArrivingShareCodeContext>
    </>
  )
}

function SharingContent({
  onChanged,
  liveList,
}: Readonly<{ onChanged: (notice: string) => void; liveList: Ref<HTMLUListElement> }>) {
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
      ownHouseholdName={me.household.name}
      onChanged={onChanged}
      liveList={liveList}
    />
  )
}

function ProfileSharing({
  profile,
  ownHouseholdName,
  onChanged,
  liveList,
}: Readonly<{
  profile: PersonalProfile
  ownHouseholdName: string
  onChanged: (notice: string) => void
  liveList: Ref<HTMLUListElement>
}>) {
  const variables = { profileId: profile.id }
  // The query asks for the Profile's shares at every status.
  const liveShares = useLiveList({
    query: ProfileSharesDocument,
    variables,
    keyOf: shareIdOf,
    apply: (data, change: ShareChange) => {
      const edges = withShareChange(data.profileShares.edges, change, (share) =>
        keepsInProfileShares(share, variables, new Date()),
      )
      return { ...data, profileShares: { ...data.profileShares, edges } }
    },
  })
  useShareChanges(liveShares.receive)
  // Offers are accepted, declined and expire elsewhere, so a visit shows only the server's answer.
  const query = useQuery(ProfileSharesDocument, {
    variables,
    fetchPolicy: 'network-only',
    context: liveShares.context,
  })
  // A failed read keeps the list that is on screen.
  const readAgain = () => query.refetch().catch(() => undefined)
  const listed = query.data?.profileShares.edges.map((edge) => edge.node) ?? []
  // An offer whose time runs out is over, as the query would count it.
  const now = useNow(listed.map((share) => share.expiresAt))

  if (query.loading && !query.data) {
    return <SharingLoading />
  }

  if (query.error || !query.data) {
    return <SharingUnavailable error={query.error} onRetry={readAgain} />
  }

  // Every Personal Profile is shared with its Account's own Household, and that share cannot
  // end, so it is no news here.
  const shares = listed
    .filter((share) => !share.requiredByAccountMembership)
    .map((share) => ({ ...share, status: statusAt(share, now) }))

  return (
    <WhereShared
      profile={profile}
      shares={shares}
      householdName={householdNamer(shares)}
      ownHouseholdName={ownHouseholdName}
      readAgain={readAgain}
      onChanged={onChanged}
      liveList={liveList}
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
