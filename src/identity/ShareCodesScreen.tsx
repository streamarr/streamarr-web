import { Button, Center, Loader } from '@mantine/core'
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  HouseholdShareCodesDocument,
  IssueShareCodeDocument,
  WithdrawShareCodeDocument,
  type HouseholdShareCodesQuery,
  type IssueShareCodeMutation,
  type MeQuery,
} from '../graphql/generated/graphql'
import { isReading } from '../graphql/readAgain'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage } from '../graphql/userErrors'
import settingsStyles from '../styles/settings.module.css'
import { FailurePanel } from '../ui/Failure'
import { Icon } from '../ui/Icon'
import { PageNotice } from '../ui/PageNotice'
import { usePageNotice } from '../ui/usePageNotice'
import { IssuedShareCode, type CodeClipboard } from './IssuedShareCode'
import styles from './ShareCodes.module.css'
import sharingStyles from './Sharing.module.css'
import { SharingSection } from './SharingSection'
import { expiryLabel } from './shareText'
import { useMe } from './useMe'

type ShareCode = HouseholdShareCodesQuery['householdShareCodes']['edges'][number]['node']
type Issued = NonNullable<NonNullable<IssueShareCodeMutation['issueShareCode']>['issued']>
type Household = MeQuery['me']['household']
type Announce = ReturnType<typeof usePageNotice>['announce']
/** A change to the Household's codes: issuing a code, or withdrawing the code that `codeId` names. */
type Change = { kind: 'issue' } | { kind: 'withdraw'; codeId: string }
/** The code on show, and whether a list the server gave has held that code since the issue. */
type Shown = { issued: Issued; listed: boolean }

const ISSUE_FAILED = "Couldn't issue a share code."
const WITHDRAW_FAILED = "Couldn't withdraw the share code."
const ISSUED_ON = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

/**
 * The share codes of the Account's Household: the way to issue one for someone in another
 * Household, and the codes that still work, which its admins withdraw.
 */
export function ShareCodesScreen({
  clipboard,
  origin,
}: Readonly<{
  clipboard: CodeClipboard
  /** The client's origin, which a code's link opens the Sharing page on. */
  origin: string
}>) {
  const { notice, heading, announce, dismiss } = usePageNotice()

  return (
    <>
      <div className={settingsStyles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Share codes
        </h1>
      </div>
      <PageNotice onDismiss={dismiss}>{notice}</PageNotice>
      <ShareCodesContent clipboard={clipboard} origin={origin} announce={announce} />
    </>
  )
}

function ShareCodesContent({
  clipboard,
  origin,
  announce,
}: Readonly<{ clipboard: CodeClipboard; origin: string; announce: Announce }>) {
  const me = useMe()

  if (me.loading && !me.data) {
    return <ShareCodesLoading />
  }
  if (me.error || !me.data) {
    return <ShareCodesUnavailable error={me.error} onRetry={me.refetch} />
  }
  return (
    <HouseholdShareCodes
      household={me.data.me.household}
      clipboard={clipboard}
      origin={origin}
      announce={announce}
    />
  )
}

function HouseholdShareCodes({
  household,
  clipboard,
  origin,
  announce,
}: Readonly<{
  household: Household
  clipboard: CodeClipboard
  origin: string
  announce: Announce
}>) {
  // Codes are issued, spent and withdrawn elsewhere, so a visit shows only the server's answer.
  const query = useQuery(HouseholdShareCodesDocument, {
    variables: { householdId: household.id },
    fetchPolicy: 'network-only',
  })
  // The answer carries the code, which no cache may keep.
  const [issueCode] = useMutation(IssueShareCodeDocument, { fetchPolicy: 'no-cache' })
  const [withdraw] = useMutation(WithdrawShareCodeDocument)
  const [shown, setShown] = useState<Shown | null>(null)
  const afterRead = afterList(shown, query.data)
  if (afterRead !== shown) setShown(afterRead)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [withdrawRefusal, setWithdrawRefusal] = useState<string | null>(null)
  /** The change on its way. A change stays on its way until the read after the change lands. */
  const [change, setChange] = useState<Change | null>(null)
  // Apollo answers a read sent while the same read is on its way with the earlier read's answer,
  // and that answer can predate a change. So no change starts while another change, or the first
  // read of the codes, is on its way.
  const waiting = change !== null || (query.loading && !query.data)
  const issueAction = useRef<HTMLButtonElement>(null)
  /** Set when the admin closes the issued panel, so that focus returns to the issue button. */
  const returnFocus = useRef(false)
  const client = useApolloClient()

  // A disabled button takes no focus. So focus returns to the issue button once the button is
  // enabled, unless the admin has moved focus away from the page body since the panel closed.
  useEffect(() => {
    if (shown || waiting || !returnFocus.current) return
    returnFocus.current = false
    if (document.activeElement === document.body) issueAction.current?.focus()
  }, [shown, waiting])

  // A failed read keeps the list that is on screen; the query's own error state reports it.
  const readAgain = () => query.refetch().catch(() => undefined)

  // A read sent before the change can answer as if the change never happened, and a refetch now
  // would join that read. The app reads every active query again when the page comes back into
  // view or online. So a read already on its way settles first, and a fresh read follows.
  async function readAfterChange() {
    if ([...client.getObservableQueries([HouseholdShareCodesDocument])].some(isReading)) {
      await readAgain()
    }
    await readAgain()
  }

  async function issue() {
    setRefusal(null)
    setChange({ kind: 'issue' })
    try {
      const { data } = await issueCode({ variables: { input: { householdId: household.id } } })
      const errors = data?.issueShareCode?.userErrors ?? []
      if (errors.length > 0) {
        setRefusal(errors.map(userErrorMessage).join(' '))
        return
      }
      const answer = data?.issueShareCode?.issued
      if (!answer) {
        setRefusal(ISSUE_FAILED)
        return
      }
      setShown({ issued: answer, listed: false })
      await readAfterChange()
    } catch (error) {
      setRefusal(requestFailureMessage(error, ISSUE_FAILED))
    } finally {
      setChange(null)
    }
  }

  // Issuing another code is cheap, so withdrawing one asks nothing.
  async function withdrawNow(code: ShareCode) {
    setWithdrawRefusal(null)
    setChange({ kind: 'withdraw', codeId: code.id })
    try {
      const { data } = await withdraw({ variables: { input: { shareCodeId: code.id } } })
      const errors = data?.withdrawShareCode?.userErrors ?? []
      const refused = errors.length > 0
      if (refused) setWithdrawRefusal(errors.map(userErrorMessage).join(' '))
      // The shown code no longer works after either answer. The server refuses the Account that
      // issued a code only once the code was spent, withdrawn or invalidated. So the panel stops
      // offering the code for copying.
      setShown((current) => (current?.issued.shareCode.id === code.id ? null : current))
      // A refused code may have been spent or withdrawn elsewhere, so the list is read again.
      await readAfterChange()
      if (!refused) announce('Share code withdrawn.')
    } catch (error) {
      setWithdrawRefusal(requestFailureMessage(error, WITHDRAW_FAILED))
    } finally {
      setChange(null)
    }
  }

  return (
    <div className={styles.page}>
      <p className={styles.intro}>
        Give a code to someone in another Household so they can offer a Profile to {household.name}.
        A code works once, and an admin here still decides on every offer.
      </p>
      {refusal && (
        <p className={sharingStyles.refusal} role="alert">
          {refusal}
        </p>
      )}
      <Button
        ref={issueAction}
        leftSection={<Icon name="plus" />}
        loading={change?.kind === 'issue'}
        disabled={waiting}
        onClick={() => void issue()}
      >
        Issue a share code
      </Button>
      {shown && (
        <IssuedShareCode
          key={shown.issued.shareCode.id}
          code={shown.issued.code}
          expiresAt={shown.issued.shareCode.expiresAt}
          clipboard={clipboard}
          origin={origin}
          onCopied={(notice) => announce(notice, { inPlace: true })}
          onDone={() => {
            returnFocus.current = true
            setShown(null)
          }}
        />
      )}
      <LiveShareCodes
        listed={query.data}
        loading={query.loading}
        error={query.error}
        readAgain={readAgain}
        withdrawing={change?.kind === 'withdraw' ? change.codeId : null}
        waiting={waiting}
        refusal={withdrawRefusal}
        onWithdraw={(code) => void withdrawNow(code)}
      />
    </div>
  )
}

// The code on show after `listed`, the last list the server gave. The list read before the issue
// never holds the new code. So only a list that leaves out a code that an earlier list held proves
// that the code stopped working, and the page then stops showing the code.
function afterList(
  shown: Shown | null,
  listed: HouseholdShareCodesQuery | undefined,
): Shown | null {
  if (!shown || !listed) return shown
  const id = shown.issued.shareCode.id
  const holds = listed.householdShareCodes.edges.some((edge) => edge.node.id === id)
  if (holds) return shown.listed ? shown : { ...shown, listed: true }
  return shown.listed ? null : shown
}

function LiveShareCodes({
  listed,
  loading,
  error,
  readAgain,
  withdrawing,
  waiting,
  refusal,
  onWithdraw,
}: Readonly<{
  /** The last list the server gave, if any. */
  listed: HouseholdShareCodesQuery | undefined
  loading: boolean
  error: unknown
  readAgain: () => Promise<unknown>
  /** The code whose withdrawal is on its way, if any. */
  withdrawing: string | null
  /** True while another change is on its way, so that no withdrawal may start. */
  waiting: boolean
  /** Why the server refused the last withdrawal, if it did. */
  refusal: string | null
  onWithdraw: (code: ShareCode) => void
}>) {
  if (loading && !listed) {
    return <ShareCodesLoading />
  }
  if (error || !listed) {
    return <ShareCodesUnavailable error={error} onRetry={readAgain} />
  }

  const codes = listed.householdShareCodes.edges.map((edge) => edge.node)

  return (
    <SharingSection title="Live codes" failure={refusal}>
      {codes.length === 0 && <p className={sharingStyles.note}>No live share codes.</p>}
      <ul className={sharingStyles.rows}>
        {codes.map((code) => (
          <LiveShareCodeRow
            key={code.id}
            code={code}
            withdrawing={withdrawing === code.id}
            disabled={waiting}
            onWithdraw={() => onWithdraw(code)}
          />
        ))}
      </ul>
    </SharingSection>
  )
}

function LiveShareCodeRow({
  code,
  withdrawing,
  disabled,
  onWithdraw,
}: Readonly<{
  code: ShareCode
  withdrawing: boolean
  disabled: boolean
  onWithdraw: () => void
}>) {
  const facts = useId()
  // The spaces keep the facts apart where Withdraw's description reads them as one sentence.
  return (
    <li className={sharingStyles.row}>
      <span id={facts} className={sharingStyles.rowText}>
        {code.issuedByDisplayName
          ? `Issued by ${code.issuedByDisplayName}`
          : 'Issued by a deleted Account'}{' '}
        <span className={sharingStyles.status}>{ISSUED_ON.format(new Date(code.issuedAt))}</span>{' '}
        <span className={sharingStyles.status}>{expiryLabel(code.expiresAt, new Date())}</span>
      </span>
      <Button
        variant="default"
        aria-describedby={facts}
        loading={withdrawing}
        disabled={disabled}
        onClick={onWithdraw}
      >
        Withdraw
      </Button>
    </li>
  )
}

function ShareCodesLoading() {
  return (
    <Center h={200}>
      <Loader role="status" aria-label="Loading share codes" />
    </Center>
  )
}

function ShareCodesUnavailable({
  error,
  onRetry,
}: Readonly<{ error: unknown; onRetry: () => unknown }>) {
  return (
    <FailurePanel onRetry={onRetry}>
      {requestFailureMessage(error, "Couldn't load share codes.")}
    </FailurePanel>
  )
}
