import { Button, Center, Loader } from '@mantine/core'
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react'
import { useEffect, useRef, useState, type Ref } from 'react'
import {
  EndProfileShareDocument,
  RevokeDeviceRegistrationDocument,
  SharedWithHouseholdDocument,
  VisitorDevicesDocument,
  type MeQuery,
  type SharedProfileFieldsFragment,
  type SharedWithHouseholdQuery,
  type VisitorDevicesQuery,
} from '../graphql/generated/graphql'
import { useLiveList } from '../graphql/liveList'
import { readQueriesAgain } from '../graphql/readAgain'
import { requestFailureMessage } from '../graphql/requestErrors'
import settingsStyles from '../styles/settings.module.css'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FailurePanel, FailureRow } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { useFocusFallback } from '../ui/useFocusFallback'
import { usePageNotice } from '../ui/usePageNotice'
import styles from './Sharing.module.css'
import { SharedProfileText } from './SharedProfileText'
import { createShareListUpdater, shareIdOf, type ShareChange } from './shareLists'
import { SharingSection } from './SharingSection'
import { useConfirmedChange } from './useConfirmedChange'
import { useMe } from './useMe'
import { useShareChanges } from './useShareChanges'

type ListedShare = SharedWithHouseholdQuery['householdShares']['edges'][number]['node']
/** A share as the page lists it: one whose Profile the server names. */
type VisitorShare = ListedShare & { profile: SharedProfileFieldsFragment }
type VisitorTv = VisitorDevicesQuery['householdDevices']['edges'][number]['node']
type Household = MeQuery['me']['household']
type Announce = (notice: string) => void
/** Where focus that a change takes away from a row returns to the page's heading. */
type LiveList = Ref<HTMLUListElement>

const DAY = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

/**
 * What other Households bring into the Account's Household: the Profiles shared with it, which its
 * admins may stop sharing, and the TVs that visitors linked here, which its admins may unlink.
 */
export function SharedWithUsScreen() {
  const { notice, count, heading, announce, dismiss } = usePageNotice()
  const liveList = useFocusFallback(heading)

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Shared with us
        </h1>
      </div>
      <PageNotice count={count} onDismiss={dismiss}>
        {notice}
      </PageNotice>
      <SharedWithUsContent announce={announce} liveList={liveList} />
    </>
  )
}

function SharedWithUsContent({
  announce,
  liveList,
}: Readonly<{ announce: Announce; liveList: LiveList }>) {
  const me = useMe()

  if (me.loading && !me.data) {
    return <ListLoading label="Loading what is shared here" />
  }
  if (me.error || !me.data) {
    return (
      <ListUnavailable
        error={me.error}
        onRetry={me.refetch}
        fallback="Couldn't load what is shared here."
      />
    )
  }
  const { household } = me.data.me
  return (
    <div className={styles.sections}>
      <SharedProfiles household={household} announce={announce} liveList={liveList} />
      <VisitorTvs household={household} announce={announce} liveList={liveList} />
    </div>
  )
}

function SharedProfiles({
  household,
  announce,
  liveList,
}: Readonly<{
  household: Household
  announce: Announce
  liveList: LiveList
}>) {
  const client = useApolloClient()
  const variables = { householdId: household.id }
  const [applyChange] = useState(createShareListUpdater)
  const liveShares = useLiveList({
    query: SharedWithHouseholdDocument,
    variables,
    keyOf: shareIdOf,
    apply: (data, change: ShareChange) => {
      const edge =
        change.visitorsEdge && change.share?.householdId === household.id
          ? { ...change.visitorsEdge, node: change.share }
          : null
      const edges = applyChange(data.householdShares, { shareId: change.shareId, edge })
      return { ...data, householdShares: { ...data.householdShares, edges } }
    },
  })
  // The shares of Personal Profiles the page has listed. A change that ends one carries no
  // Profile, and a read may already have taken it out of the list, so the page remembers them.
  const personalShares = useRef(new Set<string>())
  // The end of someone's Personal Profile's share unlinks the TVs that person linked here.
  const readTheTvsAgain = () => void readQueriesAgain(client, [VisitorDevicesDocument])
  useShareChanges((change) => {
    const data = client.cache.readQuery({ query: SharedWithHouseholdDocument, variables })
    const prior = data?.householdShares.edges.find((edge) => edge.node.id === change.shareId)?.node
    // A cache read can complete before the page draws it.
    rememberPersonalShares(personalShares.current, data?.householdShares.edges)
    liveShares.receive(change)
    const relevant = change.share === null || change.share.householdId === household.id
    // An ended share hides its Profile facts, so an unseen one may have unlinked visitor TVs too.
    if (!relevant || change.visitorsEdge) return
    const wasPersonal = personalShares.current.delete(change.shareId)
    if (wasPersonal || prior?.profile?.personalProfile !== false) readTheTvsAgain()
  })
  // Shares start and end elsewhere, so a visit shows only the server's answer.
  const query = useQuery(SharedWithHouseholdDocument, {
    variables,
    fetchPolicy: 'network-only',
    context: liveShares.context,
  })
  const [end] = useMutation(EndProfileShareDocument)
  const readAgain = () => query.refetch().catch(() => undefined)
  const listed = query.data?.householdShares.edges
  const ending = useConfirmedChange<VisitorShare>({
    send: async (share) =>
      (await end({ variables: { input: { shareId: share.id } } })).data?.endProfileShare
        ?.userErrors ?? [],
    // Ending the share of someone's Personal Profile also unlinks the TVs that person linked here.
    listsToReadAgain: [SharedWithHouseholdDocument, VisitorDevicesDocument],
    onDone: (share) => announce(`Sharing of ${share.profile.name} ended.`),
    listed: query.error ? undefined : listed?.map((edge) => edge.node),
    onGone: (share) => announce(`${share.profile.name} is no longer shared here.`),
  })

  useEffect(() => rememberPersonalShares(personalShares.current, listed), [listed])

  if (query.loading && !query.data) {
    return <ListLoading label="Loading shared Profiles" />
  }
  if (query.error || !query.data) {
    return (
      <SharingSection title={`Profiles shared with ${household.name}`} failure={null}>
        <FailureRow onRetry={readAgain}>
          {requestFailureMessage(query.error, "Couldn't load the Profiles shared here.")}
        </FailureRow>
      </SharingSection>
    )
  }

  const shares = query.data.householdShares.edges.map((edge) => edge.node).filter(namesItsProfile)

  return (
    <SharingSection
      title={`Profiles shared with ${household.name}`}
      failure={ending.pending ? null : ending.refusal}
    >
      {shares.length === 0 && (
        <p className={styles.note}>
          No Profile from another Household is shared with {household.name}.
        </p>
      )}
      <ul ref={liveList} className={styles.rows}>
        {shares.map((share) => (
          <li key={share.id} className={styles.row}>
            <SharedProfileText
              profile={share.profile}
              byline={share.offeredByDisplayName && `Shared by ${share.offeredByDisplayName}`}
            />
            {/* Account membership keeps this share, and the server refuses to end it. */}
            {!share.requiredByAccountMembership && (
              <Button
                variant="default"
                aria-label={`End share of ${share.profile.name}`}
                disabled={ending.sending}
                onClick={() => ending.ask(share)}
              >
                End share
              </Button>
            )}
          </li>
        ))}
      </ul>
      <MoreRows
        pageInfo={query.data.householdShares.pageInfo}
        label="Load more Profiles"
        failureMessage="Couldn't load more Profiles."
        disabled={query.loading || ending.sending}
        read={(after) =>
          query.fetchMore({
            variables: { after },
            updateQuery: (previous, { fetchMoreResult }) => ({
              ...previous,
              householdShares: appendPage(previous.householdShares, {
                after,
                page: fetchMoreResult.householdShares,
              }),
            }),
          })
        }
      />
      <ConfirmDialog
        opened={ending.pending !== null}
        title={ending.pending ? `End the share of ${ending.pending.profile.name}?` : ''}
        body={ending.pending ? endConsequence(ending.pending.profile, household.name) : ''}
        confirmLabel="End share"
        destructive
        icon={null}
        pending={ending.sending}
        disabled={ending.changing}
        error={ending.refusal}
        onClose={ending.close}
        onConfirm={ending.confirmPending}
      />
    </SharingSection>
  )
}

function VisitorTvs({
  household,
  announce,
  liveList,
}: Readonly<{ household: Household; announce: Announce; liveList: LiveList }>) {
  // Visitors link TVs elsewhere, so a visit shows only the server's answer.
  const query = useQuery(VisitorDevicesDocument, {
    variables: { householdId: household.id },
    fetchPolicy: 'network-only',
  })
  const [revoke] = useMutation(RevokeDeviceRegistrationDocument)
  // The answer to Unlink names only the TV, so the page itself leaves out each TV that it unlinked.
  const [unlinked, setUnlinked] = useState<ReadonlySet<string>>(() => new Set())
  const readAgain = () => query.refetch().catch(() => undefined)
  const tvs = query.data?.householdDevices.edges
    .map((edge) => edge.node)
    .filter((tv) => !unlinked.has(tv.id))
  const unlinking = useConfirmedChange<VisitorTv>({
    send: async (tv) =>
      (await revoke({ variables: { input: { registrationId: tv.id } } })).data
        ?.revokeDeviceRegistration?.userErrors ?? [],
    listsToReadAgain: [VisitorDevicesDocument],
    onDone: (tv) => {
      setUnlinked((ids) => new Set(ids).add(tv.id))
      announce(`${tv.displayName} unlinked.`)
    },
    listed: query.error ? undefined : tvs,
    onGone: (tv) => announce(`${tv.displayName} is no longer linked here.`),
  })

  if (query.loading && !query.data) {
    return <ListLoading label="Loading linked TVs" />
  }
  if (query.error || !query.data || !tvs) {
    return (
      <SharingSection title="TVs linked by visitors" failure={null}>
        <FailureRow onRetry={readAgain}>
          {requestFailureMessage(query.error, "Couldn't load the TVs linked here.")}
        </FailureRow>
      </SharingSection>
    )
  }

  return (
    <SharingSection
      title="TVs linked by visitors"
      failure={unlinking.pending ? null : unlinking.refusal}
    >
      {tvs.length === 0 && <p className={styles.note}>No visitor has linked a TV here.</p>}
      <ul ref={liveList} className={styles.rows}>
        {tvs.map((tv) => (
          <li key={tv.id} className={styles.row}>
            <span className={styles.rowText}>
              {tv.displayName}
              <span className={styles.status}>
                {tv.authorizingAccountDisplayName
                  ? `Linked by ${tv.authorizingAccountDisplayName}`
                  : 'Linked by a deleted Account'}
              </span>
              <span className={styles.status}>{DAY.format(new Date(tv.pairedAt))}</span>
            </span>
            <Button
              variant="default"
              aria-label={`Unlink ${tv.displayName}`}
              disabled={unlinking.sending}
              onClick={() => unlinking.ask(tv)}
            >
              Unlink
            </Button>
          </li>
        ))}
      </ul>
      <MoreRows
        pageInfo={query.data.householdDevices.pageInfo}
        label="Load more TVs"
        failureMessage="Couldn't load more TVs."
        disabled={query.loading || unlinking.sending}
        read={(after) =>
          query.fetchMore({
            variables: { after },
            updateQuery: (previous, { fetchMoreResult }) => ({
              ...previous,
              householdDevices: appendPage(previous.householdDevices, {
                after,
                page: fetchMoreResult.householdDevices,
              }),
            }),
          })
        }
      />
      <ConfirmDialog
        opened={unlinking.pending !== null}
        title={unlinking.pending ? `Unlink ${unlinking.pending.displayName}?` : ''}
        body={
          unlinking.pending
            ? `${unlinking.pending.displayName} is signed out of ${household.name}. It must be linked again before it can be used here.`
            : ''
        }
        confirmLabel="Unlink"
        destructive
        icon={null}
        pending={unlinking.sending}
        disabled={unlinking.changing}
        error={unlinking.refusal}
        onClose={unlinking.close}
        onConfirm={unlinking.confirmPending}
      />
    </SharingSection>
  )
}

function appendPage<
  Connection extends {
    edges: { node: { id: string } }[]
    pageInfo: { endCursor?: string | null }
  },
>(previous: Connection, { after, page }: { after: string; page: Connection }): Connection {
  if (previous.pageInfo.endCursor !== after) return previous
  const edges = new Map(previous.edges.map((edge) => [edge.node.id, edge]))
  for (const edge of page.edges) edges.set(edge.node.id, edge)
  return { ...page, edges: [...edges.values()] }
}

function MoreRows({
  pageInfo,
  label,
  failureMessage,
  disabled,
  read,
}: Readonly<{
  pageInfo: { hasNextPage: boolean; endCursor?: string | null }
  label: string
  failureMessage: string
  disabled: boolean
  read: (after: string) => Promise<unknown>
}>) {
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const after = pageInfo.endCursor
  if (!pageInfo.hasNextPage || !after) return null

  async function load() {
    setSending(true)
    setFailure(null)
    try {
      await read(after!)
    } catch (error) {
      setFailure(requestFailureMessage(error, failureMessage))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {failure && <p role="alert">{failure}</p>}
      <Button variant="default" disabled={disabled} loading={sending} onClick={() => void load()}>
        {label}
      </Button>
    </>
  )
}

/** What ending the share stops, as the server does it for this Profile. */
function endConsequence(profile: SharedProfileFieldsFragment, household: string): string {
  const stops = `${profile.name} stops being available in ${household}, and anyone using it here returns to the Profile picker.`
  if (!profile.personalProfile) return stops
  return `${stops} This is someone's Personal Profile, so that person can no longer use ${household}, and the TVs they linked here are unlinked.`
}

function rememberPersonalShares(
  remembered: Set<string>,
  edges: readonly { node: ListedShare }[] = [],
): void {
  for (const { node } of edges) {
    if (node.profile?.personalProfile) remembered.add(node.id)
  }
}

function namesItsProfile(share: ListedShare): share is VisitorShare {
  return share.profile !== null
}

function ListLoading({ label }: Readonly<{ label: string }>) {
  return (
    <Center h={120}>
      <Loader role="status" aria-label={label} />
    </Center>
  )
}

function ListUnavailable({
  error,
  onRetry,
  fallback,
}: Readonly<{ error: unknown; onRetry: () => unknown; fallback: string }>) {
  return <FailurePanel onRetry={onRetry}>{requestFailureMessage(error, fallback)}</FailurePanel>
}
