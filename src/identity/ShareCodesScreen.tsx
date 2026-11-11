import { Button, Center, Loader } from '@mantine/core'
import { useMutation, useQuery } from '@apollo/client/react'
import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
import { useNow } from './useNow'

type ShareCode = HouseholdShareCodesQuery['householdShareCodes']['edges'][number]['node']
type Issued = NonNullable<NonNullable<IssueShareCodeMutation['issueShareCode']>['issued']>
type Household = MeQuery['me']['household']
type Announce = ReturnType<typeof usePageNotice>['announce']

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
  const [issued, setIssued] = useState<Issued | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const issueAction = useRef<HTMLButtonElement>(null)
  // A failed read keeps the list that is on screen; the query's own error state reports it.
  const readAgain = () => query.refetch().catch(() => undefined)

  async function issue() {
    setRefusal(null)
    setIssuing(true)
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
      setIssuing(false)
    }
  }

  return (
    <div className={styles.page}>
      {refusal && (
        <p className={sharingStyles.refusal} role="alert">
          {refusal}
        </p>
      )}
      {/* The code takes the button's place until the admin is done with it. */}
      {issued ? (
        <IssuedShareCode
          key={issued.shareCode.id}
          code={issued.code}
          expiresAt={issued.shareCode.expiresAt}
          clipboard={clipboard}
          origin={origin}
          onCopied={(notice) => announce(notice, { inPlace: true })}
          onDone={() => {
            // The button is back before it takes focus.
            flushSync(() => setIssued(null))
            issueAction.current?.focus()
          }}
        />
      ) : (
        <Button
          ref={issueAction}
          leftSection={<Icon name="plus" />}
          loading={issuing}
          onClick={() => void issue()}
        >
          Issue a share code
        </Button>
      )}
      <LiveShareCodes
        householdName={household.name}
        listed={query.data}
        loading={query.loading}
        error={query.error}
        readAgain={readAgain}
        announce={announce}
      />
    </div>
  )
}

function LiveShareCodes({
  householdName,
  listed,
  loading,
  error,
  readAgain,
  announce,
}: Readonly<{
  householdName: string
  /** The last list the server gave, if any. */
  listed: HouseholdShareCodesQuery | undefined
  loading: boolean
  error: unknown
  readAgain: () => Promise<unknown>
  announce: Announce
}>) {
  const [withdraw] = useMutation(WithdrawShareCodeDocument)
  /** The code whose withdrawal is on its way; no other starts until it lands. */
  const [withdrawing, setWithdrawing] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  // Issuing another code is cheap, so withdrawing one asks nothing.
  async function withdrawNow(code: ShareCode) {
    setRefusal(null)
    setWithdrawing(code.id)
    try {
      const { data } = await withdraw({ variables: { input: { shareCodeId: code.id } } })
      const errors = data?.withdrawShareCode?.userErrors ?? []
      if (errors.length > 0) setRefusal(errors.map(userErrorMessage).join(' '))
      // A refused code may have been spent or withdrawn elsewhere, so the list is read again.
      await readAgain()
      if (errors.length === 0) announce('Share code withdrawn.')
    } catch (error) {
      setRefusal(requestFailureMessage(error, WITHDRAW_FAILED))
    } finally {
      setWithdrawing(null)
    }
  }

  const listedCodes = listed?.householdShareCodes.edges.map((edge) => edge.node) ?? []
  // A code stops working when its time runs out, and the query leaves it out from then on.
  const now = useNow(listedCodes.map((code) => code.expiresAt))

  if (loading && !listed) {
    return <ShareCodesLoading />
  }
  if (error || !listed) {
    return <ShareCodesUnavailable error={error} onRetry={readAgain} />
  }

  const codes = listedCodes.filter((code) => Date.parse(code.expiresAt) > now.getTime())

  return (
    <SharingSection title="Live codes" failure={refusal}>
      {codes.length === 0 && (
        <p className={sharingStyles.note}>
          No live share codes. Give one to someone in another Household so they can offer a Profile
          to {householdName}.
        </p>
      )}
      <ul className={sharingStyles.rows}>
        {codes.map((code) => (
          <LiveShareCodeRow
            key={code.id}
            code={code}
            withdrawing={withdrawing}
            onWithdraw={() => void withdrawNow(code)}
          />
        ))}
      </ul>
    </SharingSection>
  )
}

function LiveShareCodeRow({
  code,
  withdrawing,
  onWithdraw,
}: Readonly<{ code: ShareCode; withdrawing: string | null; onWithdraw: () => void }>) {
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
        loading={withdrawing === code.id}
        disabled={withdrawing !== null}
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
