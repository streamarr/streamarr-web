import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  ChangeNotificationRetentionMutation,
  ChangeNotificationRetentionMutationVariables,
  NotificationRetentionSettingFieldsFragment,
  NotificationRetentionSettingQuery,
} from '../../graphql/generated/graphql'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

const NOTIFICATIONS = '/settings/server/notifications'

function retentionFixture(
  overrides: Partial<NotificationRetentionSettingFieldsFragment> = {},
): NotificationRetentionSettingFieldsFragment {
  return {
    __typename: 'NotificationRetentionSetting',
    id: '5c0f1e2d-3b4a-4968-8776-a5b4c3d2e1f0',
    days: 90,
    minimumDays: 1,
    maximumDays: 365,
    ...overrides,
  }
}

function serve({
  retention = retentionFixture(),
  me = meFixture({ scope: 'profile', serverAdmin: true }),
} = {}) {
  const state = { retention, reads: 0, changes: [] as number[] }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('AdminLibraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query<NotificationRetentionSettingQuery>('NotificationRetentionSetting', () => {
      state.reads++
      return HttpResponse.json({ data: { notificationRetentionSetting: state.retention } })
    }),
    graphql.mutation<
      ChangeNotificationRetentionMutation,
      ChangeNotificationRetentionMutationVariables
    >('ChangeNotificationRetention', ({ variables }) => {
      state.changes.push(variables.input.days)
      state.retention = { ...state.retention, days: variables.input.days }
      return HttpResponse.json({
        data: {
          changeNotificationRetention: {
            notificationRetentionSetting: state.retention,
            userErrors: [],
          },
        },
      })
    }),
  )
  return state
}

async function retentionField() {
  return screen.findByRole('textbox', { name: 'Read notifications are kept, in days' })
}

function saveRetention() {
  return screen.getByRole('button', { name: 'Save how long read notifications are kept' })
}

async function enter(user: UserEvent, value: string) {
  const field = await retentionField()
  await user.clear(field)
  await user.type(field, value)
  return field
}

// The page notice is the one status without a name; a loading setting's status has its own.
async function expectNotice(text: string) {
  await waitFor(() => expect(screen.getByRole('status', { name: '' })).toHaveTextContent(text))
}

describe('Notification settings', () => {
  it('shouldOpenNotificationsFromTheServerSettingsRailWhenAdminChoosesIt', async () => {
    serve()
    const { user, router } = renderAppAt('/settings/server/libraries')
    const rail = await screen.findByRole('navigation', { name: 'Server settings' })

    await user.click(within(rail).getByRole('link', { name: 'Notifications' }))

    expect(await retentionField()).toHaveValue('90')
    expect(router.state.location.pathname).toBe(NOTIFICATIONS)
    expect(within(rail).getByRole('link', { name: 'Notifications' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByText('Read notifications are kept')).toBeInTheDocument()
    expect(saveRetention()).toBeDisabled()
  })

  it('shouldSaveHowLongReadNotificationsAreKeptWhenAdminEntersDaysAndSaves', async () => {
    const state = serve()
    const { user } = renderAppAt(NOTIFICATIONS)

    const field = await enter(user, '60')
    await user.click(saveRetention())

    await expectNotice('Saved. Read notifications are kept 60 days.')
    expect(state.changes).toEqual([60])
    expect(field).toHaveValue('60')
    expect(field).toHaveFocus()
  })

  it('shouldNameOneDayWhenReadNotificationsAreKeptForOneDay', async () => {
    serve()
    const { user } = renderAppAt(NOTIFICATIONS)

    await enter(user, '1')
    expect(screen.getByText('day')).toBeInTheDocument()
    await user.click(saveRetention())

    await expectNotice('Saved. Read notifications are kept 1 day.')
  })

  it.each(['0', '366'])(
    'shouldRefuseBesideTheFieldWithoutAskingServerWhenTheRetentionIsOutsideTheServerRange(%s)',
    async (entered) => {
      const state = serve()
      const { user } = renderAppAt(NOTIFICATIONS)

      const field = await enter(user, entered)
      await user.click(saveRetention())

      await waitFor(() => expect(field).toHaveAccessibleDescription('Choose from 1 to 365 days.'))
      expect(field).toHaveValue(entered)
      expect(state.changes).toEqual([])
    },
  )

  it('shouldShowServerWordsBesideTheRetentionAndKeepDraftWhenServerRefusesChange', async () => {
    const state = serve()
    server.use(
      graphql.mutation<ChangeNotificationRetentionMutation>('ChangeNotificationRetention', () =>
        HttpResponse.json({
          data: {
            changeNotificationRetention: {
              notificationRetentionSetting: null,
              userErrors: [
                {
                  __typename: 'NotificationRetentionOutOfRangeError',
                  message: 'Choose from 1 to 180 days.',
                },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(NOTIFICATIONS)

    const field = await enter(user, '200')
    await user.click(saveRetention())

    await waitFor(() => expect(field).toHaveAccessibleDescription('Choose from 1 to 180 days.'))
    expect(field).toHaveValue('200')
    expect(state.retention.days).toBe(90)
  })

  it('shouldOfferRetryWhenTheRetentionCannotBeLoaded', async () => {
    serve()
    server.use(
      graphql.query(
        'NotificationRetentionSetting',
        () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
        { once: true },
      ),
    )
    const { user } = renderAppAt(NOTIFICATIONS)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load how long read notifications are kept.",
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await retentionField()).toHaveValue('90')
  })

  it.each([
    { session: 'that of an Account that is not a ServerAdmin', me: meFixture() },
    {
      session: 'bound to a TV',
      me: meFixture({ serverAdmin: true, scope: 'profile', deviceBound: true }),
    },
  ])('shouldReadNoSettingWhenTheSessionIs($session)', async ({ me }) => {
    const state = serve({ me })
    renderAppAt(NOTIFICATIONS)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server settings are available to server admins',
    )
    expect(state.reads).toBe(0)
  })
})
