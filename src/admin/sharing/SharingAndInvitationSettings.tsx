import { useMutation, useQuery } from '@apollo/client/react'
import {
  ChangeShareCodeLimitDocument,
  ShareCodeLimitSettingDocument,
} from '../../graphql/generated/graphql'
import styles from '../../styles/settings.module.css'
import { PageNotice } from '../../ui/PageNotice'
import { usePageNotice } from '../../ui/usePageNotice'
import { AmountSetting, answerOf, type SettingWords } from './AmountSetting'
import { countOf, type Unit } from './amounts'

type OnSaved = (notice: string) => void

// Each visit shows what is cached at once and reads the server again.
const READ = { fetchPolicy: 'cache-and-network', notifyOnNetworkStatusChange: true } as const

const CODE: Unit = { size: 1, one: 'code', many: 'codes' }
const LIVE_CODE: Unit = { size: 1, one: 'live share code', many: 'live share codes' }

const LIMIT: SettingWords = {
  label: 'Live share codes per Household',
  subject: 'the share code limit',
  saved: (codes) => `Saved. A Household may hold ${countOf(codes, LIVE_CODE)}.`,
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
      unit={CODE}
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
