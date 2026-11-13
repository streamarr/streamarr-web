import { Center, Loader } from '@mantine/core'
import { useQuery } from '@apollo/client/react'
import { useState, type Ref } from 'react'
import settingsStyles from '../styles/settings.module.css'
import {
  ProfileSharesDocument,
  type ProfileShareStatus,
  type ProfileSharesQuery,
} from '../graphql/generated/graphql'
import { useLiveList } from '../graphql/liveList'
import { refetchAfterReadsInFlight } from '../graphql/readAgain'
import { requestFailureMessage } from '../graphql/requestErrors'
import { FailurePanel } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { useFocusFallback } from '../ui/useFocusFallback'
import { usePageNotice } from '../ui/usePageNotice'
import { ArrivingShareCodeContext } from './arrivingShareCode'
import { EarlierShares } from './EarlierShares'
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

/** Where the Profile is offered or shared now. */
const LIVE_STATUSES: readonly ProfileShareStatus[] = ['PENDING', 'ACTIVE']
/** The offers and shares that are over. */
const OVER_STATUSES: readonly ProfileShareStatus[] = [
  'REJECTED',
  'CANCELED',
  'EXPIRED',
  'INVALIDATED',
  'ENDED',
]

/**
 * Where the Account's Personal Profile is shared, and the way to share it with another Household.
 * A share code that the page's link carried opens the share form with it, once.
 */
export function SharingScreen({ arrivingCode = null }: Readonly<{ arrivingCode?: string | null }>) {
  const { notice, count, heading, announce, dismiss } = usePageNotice()
  const liveList = useFocusFallback(heading)
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
  const [earlierAsked, setEarlierAsked] = useState(false)
  const [earlierOpen, setEarlierOpen] = useState(false)
  const live = useShareList(profile.id, LIVE_STATUSES, false)
  // The offers and shares that are over are read only once the person asks for them.
  const over = useShareList(profile.id, OVER_STATUSES, !earlierAsked)
  useShareChanges((change) => {
    live.receive(change)
    over.receive(change)
  })
  const query = live.query
  // A failed read reports through the query's own error. Rejecting here would report the change
  // that the read follows as failed. An offer the person cancels and a share they end move to the
  // earlier ones, so those are read again too once the person has asked for them.
  const readAgain = () =>
    Promise.all(
      [query, ...(earlierAsked ? [over.query] : [])].map((each) =>
        refetchAfterReadsInFlight(each.observable).catch(() => undefined),
      ),
    )
  // A failed read empties `data`, so the last list read stays on screen with the form inside it.
  const data = query.data ?? query.previousData
  // A change on its way, its refusal, and the confirmation that it belongs to outlast the list
  // that a failed read takes off the page, so they are held here and not in the list.
  const [changing, setChanging] = useState<string | null>(null)
  const [ending, setEnding] = useState<ProfileShareRow | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  // An offer whose time runs out is over, as the queries would count it.
  const now = useNow(nodesOf(data).map((share) => share.expiresAt))

  if (query.loading && !data) {
    return <SharingLoading />
  }

  if (!data) {
    return <SharingUnavailable error={query.error} onRetry={readAgain} />
  }

  const current = listedShares(data, now)
  const expired = current.filter((share) => !isLive(share))
  const earlier = [
    ...expired,
    ...nodesOf(over.query.data).filter((share) => !expired.some(({ id }) => id === share.id)),
  ]
  const householdName = householdNamer([...current, ...earlier])
  return (
    <WhereShared
      profile={profile}
      shares={current.filter(isLive)}
      householdName={householdName}
      ownHouseholdName={ownHouseholdName}
      readFailure={query.error ? sharingFailureMessage(query.error) : null}
      readAgain={readAgain}
      onChanged={onChanged}
      changing={changing}
      onChangingChange={setChanging}
      ending={ending}
      onEndingChange={setEnding}
      refusal={refusal}
      onRefusalChange={setRefusal}
      liveList={liveList}
      earlier={
        <EarlierShares
          open={earlierOpen}
          onToggle={() => {
            setEarlierAsked(true)
            setEarlierOpen(!earlierOpen)
          }}
          shares={earlier}
          loading={over.query.loading && !over.query.data}
          failure={
            over.query.error
              ? requestFailureMessage(over.query.error, "Couldn't load earlier offers and shares.")
              : null
          }
          onRetry={() => over.query.refetch()}
          householdName={householdName}
        />
      }
    />
  )
}

// Every Personal Profile is shared with its Account's own Household, and that share cannot end,
// so it is no news here. An offer whose time runs out is over at `now`, as the query would count it.
function listedShares(data: ProfileSharesQuery, now: Date): ProfileShareRow[] {
  return nodesOf(data)
    .filter((share) => !share.requiredByAccountMembership)
    .map((share) => ({ ...share, status: statusAt(share, now) }))
}

/**
 * One of the Profile's lists of shares, in `statuses`, kept current by the changes the page
 * hands to `receive`, and read only while not skipped.
 */
function useShareList(profileId: string, statuses: readonly ProfileShareStatus[], skip: boolean) {
  const variables = { profileId, statuses: [...statuses] }
  const list = useLiveList({
    query: ProfileSharesDocument,
    variables,
    keyOf: shareIdOf,
    apply: (data, change: ShareChange) => {
      const edges = withShareChange(data.profileShares.edges, change, (share) =>
        keepsInProfileShares(share, { profileId, statuses }, new Date()),
      )
      return { ...data, profileShares: { ...data.profileShares, edges } }
    },
  })
  // Offers are accepted, declined and expire elsewhere, so a visit shows only the server's answer.
  const query = useQuery(ProfileSharesDocument, {
    variables,
    fetchPolicy: 'network-only',
    context: list.context,
    skip,
  })
  return { receive: list.receive, query }
}

function nodesOf(data: ProfileSharesQuery | undefined): ProfileShareRow[] {
  return data?.profileShares.edges.map((edge) => edge.node) ?? []
}

function isLive(share: ProfileShareRow): boolean {
  return LIVE_STATUSES.includes(share.status)
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
  return <FailurePanel onRetry={onRetry}>{sharingFailureMessage(error)}</FailurePanel>
}

function sharingFailureMessage(error: unknown): string {
  return requestFailureMessage(error, "Couldn't load sharing.")
}
