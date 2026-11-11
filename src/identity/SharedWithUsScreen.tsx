import { Button, Center, Loader } from '@mantine/core'
import type { ApolloClient, DocumentNode } from '@apollo/client'
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react'
import { useState } from 'react'
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
import { isReading } from '../graphql/readAgain'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import settingsStyles from '../styles/settings.module.css'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FailurePanel } from '../ui/Failure'
import { PageNotice } from '../ui/PageNotice'
import { useFocusFallback } from '../ui/useFocusFallback'
import { usePageNotice } from '../ui/usePageNotice'
import styles from './Sharing.module.css'
import { SharedProfileText } from './SharedProfileText'
import { keepsInHouseholdShares, withShareChange, type ShareChange } from './shareLists'
import { SharingSection } from './SharingSection'
import { UPDATE_FAILED_MESSAGE } from './shareText'
import { useMe } from './useMe'
import { useShareChanges } from './useShareChanges'

type ListedShare = SharedWithHouseholdQuery['householdShares']['edges'][number]['node']
/** A share as the page lists it: one whose Profile the server names. */
type VisitorShare = ListedShare & { profile: SharedProfileFieldsFragment }
type VisitorTv = VisitorDevicesQuery['householdDevices']['edges'][number]['node']
type Household = MeQuery['me']['household']
type Announce = (notice: string) => void

const DAY = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

/**
 * What other Households bring into the Account's Household: the Profiles shared with it, which its
 * admins may stop sharing, and the TVs that visitors linked here, which its admins may unlink.
 */
export function SharedWithUsScreen() {
  const { notice, heading, announce, dismiss } = usePageNotice()
  useFocusFallback(heading)

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Shared with us
        </h1>
      </div>
      <PageNotice onDismiss={dismiss}>{notice}</PageNotice>
      <SharedWithUsContent announce={announce} />
    </>
  )
}

function SharedWithUsContent({ announce }: Readonly<{ announce: Announce }>) {
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
      <SharedProfiles household={household} serverAdmin={serverAdmin} announce={announce} />
      <VisitorTvs household={household} announce={announce} />
    </div>
  )
}

function SharedProfiles({
  household,
  serverAdmin,
  announce,
}: Readonly<{ household: Household; serverAdmin: boolean; announce: Announce }>) {
  const client = useApolloClient()
  const variables = { householdId: household.id }
  // The shares that the query asks for.
  const list = {
    householdId: household.id,
    statuses: ['ACTIVE'] as const,
    visitorsOnly: true,
    serverAdmin,
  }
  useShareChanges((change) => {
    const { cache } = client
    const data = cache.readQuery({ query: SharedWithHouseholdDocument, variables })
    if (!data) return
    const listed = data.householdShares.edges
    const edges = withShareChange(listed, change, (share) =>
      keepsInHouseholdShares(share, list, new Date()),
    )
    cache.writeQuery({
      query: SharedWithHouseholdDocument,
      variables,
      data: { ...data, householdShares: { ...data.householdShares, edges } },
    })
    // The end of someone's Personal Profile's share unlinks the TVs that person linked here.
    if (leaving(listed, edges, change)?.profile.personalProfile) {
      void client.refetchQueries({ include: [VisitorDevicesDocument] }).catch(() => undefined)
    }
  })
  // Shares start and end elsewhere, so a visit shows only the server's answer.
  const query = useQuery(SharedWithHouseholdDocument, { variables, fetchPolicy: 'network-only' })
  const [end] = useMutation(EndProfileShareDocument)
  const readAgain = () => query.refetch().catch(() => undefined)
  const ending = useConfirmedChange<VisitorShare>({
    send: async (share) =>
      (await end({ variables: { input: { shareId: share.id } } })).data?.endProfileShare
        ?.userErrors ?? [],
    // Ending the share of someone's Personal Profile also unlinks the TVs that person linked here.
    listsToReadAgain: [SharedWithHouseholdDocument, VisitorDevicesDocument],
    onDone: (share) => announce(`Sharing of ${share.profile.name} ended.`),
  })

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
      <ul className={styles.rows}>
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
}: Readonly<{ household: Household; announce: Announce }>) {
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
      <ul className={styles.rows}>
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

/**
 * A change to one row that waits for the admin's confirmation. Once sent, the list reads again
 * whatever the answer, because a refused row may have changed elsewhere; a refusal keeps the
 * confirmation open with the server's words.
 */
function useConfirmedChange<Row>({
  send,
  listsToReadAgain,
  onDone,
}: {
  send: (row: Row) => Promise<readonly UserErrorLike[]>
  /** The queries of the lists that the change can alter. */
  listsToReadAgain: DocumentNode[]
  onDone: (row: Row) => void
}) {
  const client = useApolloClient()
  const [pending, setPending] = useState<Row | null>(null)
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  async function confirm(row: Row) {
    setRefusal(null)
    setSending(true)
    try {
      const errors = await send(row)
      if (errors.length > 0) setRefusal(errors.map(userErrorMessage).join(' '))
      await readListsAgain(client, listsToReadAgain)
      if (errors.length > 0) return
      setPending(null)
      onDone(row)
    } catch (error) {
      setRefusal(requestFailureMessage(error, UPDATE_FAILED_MESSAGE))
    } finally {
      setSending(false)
    }
  }

  return {
    pending,
    sending,
    refusal,
    ask: (row: Row) => {
      setRefusal(null)
      setPending(row)
    },
    close: () => {
      setPending(null)
      setRefusal(null)
    },
    confirmPending: () => {
      if (pending) void confirm(pending)
    },
  }
}

// A read sent before the change can answer as if the change never happened, and a refetch now
// would join that read. The app reads every active query again when the page comes back into view
// or online. So a read already on its way settles first, and a fresh read follows. A failed read
// keeps the list on screen, and the list's own query reports the failure.
function readListsAgain(client: ApolloClient, lists: DocumentNode[]): Promise<unknown> {
  return Promise.all(
    [...client.getObservableQueries(lists)].map(async (query) => {
      const refetch = () => query.refetch().catch(() => undefined)
      if (isReading(query)) await refetch()
      await refetch()
    }),
  )
}

/** What ending the share stops, as the server does it for this Profile. */
function endConsequence(profile: SharedProfileFieldsFragment, household: string): string {
  const stops = `${profile.name} stops being available in ${household}, and anyone using it here returns to the Profile picker.`
  if (!profile.personalProfile) return stops
  return `${stops} This is someone's Personal Profile, so that person can no longer use ${household}, and the TVs they linked here are unlinked.`
}

/** The listed share that the change takes out of the list, if any. */
function leaving(
  listed: readonly { node: ListedShare }[],
  edges: readonly { node: ListedShare }[],
  change: ShareChange,
): VisitorShare | null {
  if (edges.some((edge) => edge.node.id === change.shareId)) return null
  const share = listed.find((edge) => edge.node.id === change.shareId)?.node
  return share && namesItsProfile(share) ? share : null
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
