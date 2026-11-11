import { useMutation, useQuery } from '@apollo/client/react'
import {
  ChangeInvitationLifetimeDocument,
  ChangeShareCodeLifetimeDocument,
  ChangeShareCodeLimitDocument,
  InvitationLifetimeSettingDocument,
  ShareCodeLifetimeSettingDocument,
  ShareCodeLimitSettingDocument,
} from '../../graphql/generated/graphql'
import styles from '../../styles/settings.module.css'
import { PageNotice } from '../../ui/PageNotice'
import { usePageNotice } from '../../ui/usePageNotice'
import { AmountSetting, answerOf, type SettingWords } from './AmountSetting'
import { amountOf, countOf, type StoredAmount, type Unit, type Units } from './amounts'

type OnSaved = (notice: string) => void

/** A lifetime as the server keeps it, in whole hours. */
interface HoursSetting {
  hours: number
  minimumHours: number
  maximumHours: number
}

// Each visit shows what is cached at once and reads the server again.
const READ = { fetchPolicy: 'cache-and-network', notifyOnNetworkStatusChange: true } as const

const CODES: Units = [{ size: 1, one: 'code', many: 'codes' }]
const LIVE_CODE: Unit = { size: 1, one: 'live share code', many: 'live share codes' }
// The server takes a lifetime in hours; the admin may count it in hours or in days.
const HOURS_OR_DAYS: Units = [
  { size: 1, one: 'hour', many: 'hours' },
  { size: 24, one: 'day', many: 'days' },
]

const LIMIT: SettingWords = {
  label: 'Live share codes per Household',
  subject: 'the share code limit',
  saved: (codes) => `Saved. A Household may hold ${countOf(codes, LIVE_CODE)}.`,
}

const SHARE_CODE_LIFETIME: SettingWords = {
  label: 'A share code lasts',
  subject: 'how long a share code lasts',
  saved: (hours) => `Saved. A share code lasts ${amountOf(hours, HOURS_OR_DAYS)}.`,
}

const INVITATION_LIFETIME: SettingWords = {
  label: 'An invitation or an offer waits',
  subject: 'how long an invitation or an offer waits',
  saved: (hours) => `Saved. An invitation or an offer waits ${amountOf(hours, HOURS_OR_DAYS)}.`,
}

/** The server-wide rules for share codes, invitations and offers, which a ServerAdmin sets. */
export function SharingAndInvitationSettings() {
  const { notice, count, announce, dismiss } = usePageNotice()
  // A save leaves the page as it was, so its notice keeps focus where the admin is.
  const onSaved = (text: string) => announce(text, { inPlace: true })

  return (
    <>
      <div className={styles.pageHeading}>
        <h1>Sharing and invitations</h1>
      </div>
      <PageNotice count={count} onDismiss={dismiss}>
        {notice}
      </PageNotice>
      <div className={styles.formPanel}>
        <div className={styles.settingRow}>
          <ShareCodeLimit onSaved={onSaved} />
        </div>
        <div className={styles.settingRow}>
          <ShareCodeLifetime onSaved={onSaved} />
        </div>
        <div className={styles.settingRow}>
          <InvitationLifetime onSaved={onSaved} />
        </div>
      </div>
    </>
  )
}

function ShareCodeLimit({ onSaved }: Readonly<{ onSaved: OnSaved }>) {
  const query = useQuery(ShareCodeLimitSettingDocument, READ)
  const [change, { loading: saving }] = useMutation(ChangeShareCodeLimitDocument)
  const setting = (query.data ?? query.previousData)?.shareCodeLimitSetting

  async function save(codes: number) {
    const { data } = await change({ variables: { input: { codes } } })
    const payload = data?.changeShareCodeLimit
    return answerOf(payload?.userErrors, payload?.shareCodeLimitSetting?.codes)
  }

  return (
    <AmountSetting
      words={LIMIT}
      units={CODES}
      stored={
        setting && {
          value: setting.codes,
          minimum: setting.minimumCodes,
          maximum: setting.maximumCodes,
        }
      }
      read={query}
      saving={saving}
      save={save}
      onSaved={onSaved}
    />
  )
}

function ShareCodeLifetime({ onSaved }: Readonly<{ onSaved: OnSaved }>) {
  const query = useQuery(ShareCodeLifetimeSettingDocument, READ)
  const [change, { loading: saving }] = useMutation(ChangeShareCodeLifetimeDocument)
  const setting = (query.data ?? query.previousData)?.shareCodeLifetimeSetting

  async function save(hours: number) {
    const { data } = await change({ variables: { input: { hours } } })
    const payload = data?.changeShareCodeLifetime
    return answerOf(payload?.userErrors, payload?.shareCodeLifetimeSetting?.hours)
  }

  return (
    <AmountSetting
      words={SHARE_CODE_LIFETIME}
      units={HOURS_OR_DAYS}
      stored={storedHours(setting)}
      read={query}
      saving={saving}
      save={save}
      onSaved={onSaved}
    />
  )
}

// An Account invitation, a manager invitation and an offer of a Profile all wait this long.
function InvitationLifetime({ onSaved }: Readonly<{ onSaved: OnSaved }>) {
  const query = useQuery(InvitationLifetimeSettingDocument, READ)
  const [change, { loading: saving }] = useMutation(ChangeInvitationLifetimeDocument)
  const setting = (query.data ?? query.previousData)?.invitationLifetimeSetting

  async function save(hours: number) {
    const { data } = await change({ variables: { input: { hours } } })
    const payload = data?.changeInvitationLifetime
    return answerOf(payload?.userErrors, payload?.invitationLifetimeSetting?.hours)
  }

  return (
    <AmountSetting
      words={INVITATION_LIFETIME}
      units={HOURS_OR_DAYS}
      stored={storedHours(setting)}
      read={query}
      saving={saving}
      save={save}
      onSaved={onSaved}
    />
  )
}

function storedHours(setting: HoursSetting | undefined): StoredAmount | undefined {
  if (!setting) return undefined
  return { value: setting.hours, minimum: setting.minimumHours, maximum: setting.maximumHours }
}
