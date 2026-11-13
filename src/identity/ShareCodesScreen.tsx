import { Button, Center, Loader } from '@mantine/core'
import { useMutation, useQuery } from '@apollo/client/react'
import { useId, useRef, useState } from 'react'
import {
  HouseholdShareCodesDocument,
  IssueShareCodeDocument,
  WithdrawShareCodeDocument,
  type HouseholdShareCodesQuery,
  type IssueShareCodeMutation,
  type MeQuery,
} from '../graphql/generated/graphql'
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
  const [issued, setIssued] = useState<Issued | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [withdrawRefusal, setWithdrawRefusal] = useState<string | null>(null)
  /** The change on its way. A change stays on its way until the read after the change lands. */
  const [change, setChange] = useState<Change | null>(null)
  // Apollo answers a read sent while the same read is on its way with the earlier read's answer,
  // and that answer can predate a change. So no change starts while another change, or the first
  // read of the codes, is on its way.
  const waiting = change !== null || (query.loading && !query.data)
  const issueAction = useRef<HTMLButtonElement>(null)
  // A failed read keeps the list that is on screen; the query's own error state reports it.
  const readAgain = () => query.refetch().catch(() => undefined)

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
      setIssued(answer)
      await readAgain()
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
      if (errors.length > 0) setWithdrawRefusal(errors.map(userErrorMessage).join(' '))
      // A refused code may have been spent or withdrawn elsewhere, so the list is read again.
      await readAgain()
      if (errors.length === 0) announce('Share code withdrawn.')
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
      {issued && (
        <IssuedShareCode
          key={issued.shareCode.id}
          code={issued.code}
          expiresAt={issued.shareCode.expiresAt}
          clipboard={clipboard}
          origin={origin}
          onCopied={(notice) => announce(notice, { inPlace: true })}
          onDone={() => {
            setIssued(null)
            issueAction.current?.focus()
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
