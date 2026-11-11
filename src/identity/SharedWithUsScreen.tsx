import { Button, Center, Loader } from '@mantine/core'
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react'
import { useEffect, useRef, type Ref } from 'react'
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
import { FailurePanel } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { useFocusFallback } from '../ui/useFocusFallback'
import { usePageNotice } from '../ui/usePageNotice'
import styles from './Sharing.module.css'
import { SharedProfileText } from './SharedProfileText'
import {
  keepsInHouseholdShares,
  shareIdOf,
  withShareChange,
  type LiveShare,
  type ShareChange,
} from './shareLists'
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
  const { notice, heading, announce, dismiss } = usePageNotice()
  const liveList = useFocusFallback(heading)

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Shared with us
        </h1>
      </div>
      <PageNotice onDismiss={dismiss}>{notice}</PageNotice>
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
  const { household, serverAdmin } = me.data.me
  return (
    <div className={styles.sections}>
      <SharedProfiles
        household={household}
        serverAdmin={serverAdmin}
        announce={announce}
        liveList={liveList}
      />
      <VisitorTvs household={household} announce={announce} liveList={liveList} />
    </div>
  )
}

function SharedProfiles({
  household,
  serverAdmin,
  announce,
  liveList,
}: Readonly<{
  household: Household
  serverAdmin: boolean
  announce: Announce
  liveList: LiveList
}>) {
  const client = useApolloClient()
  const variables = { householdId: household.id }
  // The shares that the query asks for.
  const list = {
    householdId: household.id,
    statuses: ['ACTIVE'] as const,
    visitorsOnly: true,
    serverAdmin,
  }
  const keeps = (share: LiveShare) => keepsInHouseholdShares(share, list, new Date())
  const liveShares = useLiveList({
    query: SharedWithHouseholdDocument,
    variables,
    keyOf: shareIdOf,
    apply: (data, change: ShareChange) => {
      const edges = withShareChange(data.householdShares.edges, change, keeps)
      return { ...data, householdShares: { ...data.householdShares, edges } }
    },
  })
  // The shares of Personal Profiles the page has listed. A change that ends one carries no
  // Profile, and a read may already have taken it out of the list, so the page remembers them.
  const personalShares = useRef(new Set<string>())
  // The end of someone's Personal Profile's share unlinks the TVs that person linked here.
  const readTheTvsAgain = () => void readQueriesAgain(client, [VisitorDevicesDocument])
  useShareChanges((change) => {
    liveShares.receive(change)
    if (change.share && keeps(change.share)) return
    if (!personalShares.current.delete(change.shareId)) return
    readTheTvsAgain()
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

  useEffect(() => {
    for (const { node } of listed ?? []) {
      if (node.profile?.personalProfile) personalShares.current.add(node.id)
    }
  }, [listed])

  if (query.loading && !query.data) {
    return <ListLoading label="Loading shared Profiles" />
  }
  if (query.error || !query.data) {
    return (
      <ListUnavailable
        error={query.error}
        onRetry={readAgain}
        fallback="Couldn't load the Profiles shared here."
      />
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
        {shares.map((share, index) => (
          <li key={share.id} className={styles.row}>
            <SharedProfileText
              profile={share.profile}
              byline={share.offeredByDisplayName && `Shared by ${share.offeredByDisplayName}`}
              paletteIndex={index}
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
      <ConfirmDialog
        opened={ending.pending !== null}
        title={ending.pending ? `End the share of ${ending.pending.profile.name}?` : ''}
        body={ending.pending ? endConsequence(ending.pending.profile, household.name) : ''}
        confirmLabel="End share"
        destructive
        icon={null}
        pending={ending.sending}
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
  const readAgain = () => query.refetch().catch(() => undefined)
  const unlinking = useConfirmedChange<VisitorTv>({
    send: async (tv) =>
      (await revoke({ variables: { input: { registrationId: tv.id } } })).data
        ?.revokeDeviceRegistration?.userErrors ?? [],
    listsToReadAgain: [VisitorDevicesDocument],
    onDone: (tv) => announce(`${tv.displayName} unlinked.`),
    listed: query.error ? undefined : query.data?.householdDevices.edges.map((edge) => edge.node),
    onGone: (tv) => announce(`${tv.displayName} is no longer linked here.`),
  })

  if (query.loading && !query.data) {
    return <ListLoading label="Loading linked TVs" />
  }
  if (query.error || !query.data) {
    return (
      <ListUnavailable
        error={query.error}
        onRetry={readAgain}
        fallback="Couldn't load the TVs linked here."
      />
    )
  }

  const tvs = query.data.householdDevices.edges.map((edge) => edge.node)

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
        error={unlinking.refusal}
        onClose={unlinking.close}
        onConfirm={unlinking.confirmPending}
      />
    </SharingSection>
  )
}

/** What ending the share stops, as the server does it for this Profile. */
function endConsequence(profile: SharedProfileFieldsFragment, household: string): string {
  const stops = `${profile.name} stops being available in ${household}, and anyone using it here returns to the Profile picker.`
  if (!profile.personalProfile) return stops
  return `${stops} This is someone's Personal Profile, so that person can no longer use ${household}, and the TVs they linked here are unlinked.`
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
