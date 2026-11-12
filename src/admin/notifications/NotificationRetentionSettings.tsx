import { useMutation, useQuery } from '@apollo/client/react'
import {
  ChangeNotificationRetentionDocument,
  NotificationRetentionSettingDocument,
} from '../../graphql/generated/graphql'
import {
  AmountSetting,
  answerOf,
  SETTING_READ,
  type OnSaved,
  type SettingWords,
} from '../sharing/AmountSetting'
import { amountOf, type Units } from '../sharing/amounts'

const DAYS: Units = [{ size: 1, one: 'day', many: 'days' }]

const RETENTION: SettingWords = {
  label: 'Notifications are kept',
  subject: 'how long Notifications are kept',
  saved: (days) => `Saved. Notifications are kept ${amountOf(days, DAYS)}.`,
  unitAfterNumber: true,
}

/** How long the server keeps read news and resolved requests, which the server counts in days. */
export function NotificationRetention({ onSaved }: Readonly<{ onSaved: OnSaved }>) {
  const query = useQuery(NotificationRetentionSettingDocument, SETTING_READ)
  const [change, { loading: saving }] = useMutation(ChangeNotificationRetentionDocument)
  const setting = (query.data ?? query.previousData)?.notificationRetentionSetting

  async function save(days: number) {
    const { data } = await change({ variables: { input: { days } } })
    const payload = data?.changeNotificationRetention
    return answerOf(payload?.userErrors, payload?.notificationRetentionSetting?.days)
  }

  return (
    <AmountSetting
      words={RETENTION}
      units={DAYS}
      stored={
        setting && {
          value: setting.days,
          minimum: setting.minimumDays,
          maximum: setting.maximumDays,
        }
      }
      read={query}
      saving={saving}
      save={save}
      onSaved={onSaved}
    />
  )
}
