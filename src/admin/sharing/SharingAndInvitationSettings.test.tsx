import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  ChangeShareCodeLimitMutation,
  ChangeShareCodeLimitMutationVariables,
  ShareCodeLimitSettingFieldsFragment,
  ShareCodeLimitSettingQuery,
} from '../../graphql/generated/graphql'
import { deferred } from '../../test/deferred'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

const SHARING = '/settings/server/sharing'
const SETTINGS_ID = '5c0f1e2d-3b4a-4968-8776-a5b4c3d2e1f0'
const UNCONFIRMED =
  "Couldn't confirm the change. Refresh the page to check the saved setting before trying again."

function limitFixture(
  overrides: Partial<ShareCodeLimitSettingFieldsFragment> = {},
): ShareCodeLimitSettingFieldsFragment {
  return {
    __typename: 'ShareCodeLimitSetting',
    id: SETTINGS_ID,
    codes: 10,
    minimumCodes: 1,
    maximumCodes: 100,
    ...overrides,
  }
}

function serve({
  limit = limitFixture(),
  me = meFixture({ scope: 'profile', serverAdmin: true }),
} = {}) {
  const state = { limit, limitChanges: [] as number[], limitReads: 0 }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('AdminLibraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query<ShareCodeLimitSettingQuery>('ShareCodeLimitSetting', () => {
      state.limitReads++
      return HttpResponse.json({ data: { shareCodeLimitSetting: state.limit } })
    }),
    graphql.mutation<ChangeShareCodeLimitMutation, ChangeShareCodeLimitMutationVariables>(
      'ChangeShareCodeLimit',
      ({ variables }) => {
        state.limitChanges.push(variables.input.codes)
        state.limit = { ...state.limit, codes: variables.input.codes }
        return HttpResponse.json({
          data: { changeShareCodeLimit: { shareCodeLimitSetting: state.limit, userErrors: [] } },
        })
      },
    ),
  )
  return state
}

function refuseLimitChanges(message: string) {
  server.use(
    graphql.mutation<ChangeShareCodeLimitMutation>('ChangeShareCodeLimit', () =>
      HttpResponse.json({
        data: {
          changeShareCodeLimit: {
            shareCodeLimitSetting: null,
            userErrors: [{ __typename: 'ShareCodeLimitOutOfRangeError', message }],
          },
        },
      }),
    ),
  )
}

function failLimitChanges({ once = false } = {}) {
  server.use(
    graphql.mutation(
      'ChangeShareCodeLimit',
      () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
      { once },
    ),
  )
}

async function limitField() {
  return screen.findByRole('textbox', { name: 'Live share codes per Household' })
}

function saveLimit() {
  return screen.getByRole('button', { name: 'Save the share code limit' })
}

async function enterLimit(user: UserEvent, codes: string) {
  const field = await limitField()
  await user.clear(field)
  await user.type(field, codes)
  return field
}

// Leaves for Libraries and comes back, so the page starts from the cached settings and reads again.
async function returnToSharing(user: UserEvent) {
  const rail = screen.getByRole('navigation', { name: 'Server settings' })
  await user.click(within(rail).getByRole('link', { name: 'Libraries' }))
  await screen.findByRole('region', { name: 'Library administration' })
  await user.click(within(rail).getByRole('link', { name: 'Sharing and invitations' }))
}

describe('sharing and invitation settings', () => {
  it('shouldOpenSharingAndInvitationsFromTheServerSettingsRailWhenAdminChoosesIt', async () => {
    serve()
    const { user, router } = renderAppAt('/settings/server/libraries')
    const rail = await screen.findByRole('navigation', { name: 'Server settings' })
    await user.click(within(rail).getByRole('link', { name: 'Sharing and invitations' }))
    expect(await limitField()).toHaveValue('10')
    expect(router.state.location.pathname).toBe(SHARING)
    expect(within(rail).getByRole('link', { name: 'Sharing and invitations' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('region', { name: 'Sharing and invitations' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sharing and invitations' }),
    ).toBeInTheDocument()
    expect(saveLimit()).toBeDisabled()
  })

  it('shouldSaveLimitAndSayItWasSavedWhenAdminEntersCodesAndSaves', async () => {
    const state = serve()
    const { user } = renderAppAt(SHARING)
    const field = await enterLimit(user, '20')
    await user.click(saveLimit())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved. A Household may hold 20 live share codes.',
    )
    expect(state.limitChanges).toEqual([20])
    expect(field).toHaveValue('20')
    expect(saveLimit()).toBeDisabled()
    expect(field).toHaveFocus()
  })

  it('shouldNameOneCodeWhenAdminSavesALimitOfOne', async () => {
    serve()
    const { user } = renderAppAt(SHARING)
    await enterLimit(user, '1')
    await user.click(saveLimit())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved. A Household may hold 1 live share code.',
    )
  })

  it('shouldSaveLimitWhenAdminPressesEnterInTheField', async () => {
    const state = serve()
    const { user } = renderAppAt(SHARING)
    const field = await enterLimit(user, '25')
    await user.type(field, '{Enter}')
    await waitFor(() => expect(state.limitChanges).toEqual([25]))
    expect(field).toHaveFocus()
  })

  it('shouldKeepSaveDisabledWhenLimitIsEmpty', async () => {
    serve()
    const { user } = renderAppAt(SHARING)
    await user.clear(await limitField())
    expect(saveLimit()).toBeDisabled()
  })

  it.each(['0', '101', '2147483648'])(
    'shouldRefuseBesideTheFieldWithoutAskingServerWhenLimitIsOutsideTheServerRange(%s)',
    async (entered) => {
      const state = serve()
      const { user } = renderAppAt(SHARING)
      const field = await enterLimit(user, entered)
      await user.click(saveLimit())
      expect(await screen.findByText('Choose from 1 to 100 codes.')).toBeInTheDocument()
      expect(field).toBeInvalid()
      expect(field).toHaveAccessibleDescription('Choose from 1 to 100 codes.')
      expect(field).toHaveValue(entered)
      expect(field).toHaveFocus()
      expect(state.limitChanges).toEqual([])
    },
  )

  it('shouldNameTheRangeTheServerReportsWhenItDiffersFromTheDefault', async () => {
    serve({ limit: limitFixture({ minimumCodes: 2, maximumCodes: 40 }) })
    const { user } = renderAppAt(SHARING)
    await enterLimit(user, '41')
    await user.click(saveLimit())
    expect(await limitField()).toHaveAccessibleDescription('Choose from 2 to 40 codes.')
  })

  it('shouldShowServerWordsBesideLimitAndKeepDraftWhenServerRefusesChange', async () => {
    const state = serve()
    refuseLimitChanges('Choose from 1 to 50 codes.')
    const { user } = renderAppAt(SHARING)
    const field = await enterLimit(user, '60')
    await user.click(saveLimit())
    await waitFor(() => expect(field).toHaveAccessibleDescription('Choose from 1 to 50 codes.'))
    expect(field).toBeInvalid()
    expect(field).toHaveValue('60')
    expect(field).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(state.limit.codes).toBe(10)
  })

  it('shouldClearRefusalWhenAdminEditsRefusedLimit', async () => {
    serve()
    const { user } = renderAppAt(SHARING)
    const field = await enterLimit(user, '0')
    await user.click(saveLimit())
    expect(await screen.findByText('Choose from 1 to 100 codes.')).toBeInTheDocument()
    await enterLimit(user, '10')
    expect(screen.queryByText('Choose from 1 to 100 codes.')).not.toBeInTheDocument()
    expect(field).toBeValid()
    expect(saveLimit()).toBeDisabled()
  })

  it('shouldSayChangeIsUnconfirmedAndKeepDraftWhenSaveCannotBeConfirmed', async () => {
    serve()
    failLimitChanges()
    const { user } = renderAppAt(SHARING)
    const field = await enterLimit(user, '30')
    await user.click(saveLimit())
    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument()
    expect(field).toHaveAccessibleDescription(UNCONFIRMED)
    expect(field).toHaveValue('30')
    expect(field).toHaveFocus()
  })

  it('shouldKeepUnconfirmedMessageWhenAdminEditsAfterUnconfirmedSave', async () => {
    serve()
    failLimitChanges()
    const { user } = renderAppAt(SHARING)
    const field = await enterLimit(user, '30')
    await user.click(saveLimit())
    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument()
    await user.type(field, '5')
    expect(field).toHaveValue('305')
    expect(field).toHaveAccessibleDescription(UNCONFIRMED)
  })

  it('shouldClearUnconfirmedMessageWhenLaterSaveIsConfirmed', async () => {
    const state = serve()
    failLimitChanges({ once: true })
    const { user } = renderAppAt(SHARING)
    await enterLimit(user, '30')
    await user.click(saveLimit())
    expect(await screen.findByText(UNCONFIRMED)).toBeInTheDocument()
    await enterLimit(user, '40')
    await user.click(saveLimit())
    await waitFor(() => expect(state.limitChanges).toEqual([40]))
    await waitFor(() => expect(screen.queryByText(UNCONFIRMED)).not.toBeInTheDocument())
    expect(await limitField()).toHaveValue('40')
  })

  it('shouldOfferRetryWhenLimitCannotBeLoaded', async () => {
    serve()
    server.use(
      graphql.query(
        'ShareCodeLimitSetting',
        () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
        { once: true },
      ),
    )
    const { user } = renderAppAt(SHARING)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load the share code limit.",
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await limitField()).toHaveValue('10')
  })

  it('shouldShowRereadFailureBesideCachedLimitWhenRereadFailsOnReturn', async () => {
    const state = serve()
    const { user } = renderAppAt(SHARING)
    expect(await limitField()).toHaveValue('10')
    server.use(
      graphql.query(
        'ShareCodeLimitSetting',
        () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
        { once: true },
      ),
    )
    await returnToSharing(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load the share code limit again.",
    )
    expect(await limitField()).toHaveValue('10')
    state.limit = { ...state.limit, codes: 15 }
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(async () => expect(await limitField()).toHaveValue('15'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldKeepSaveDisabledAndKeepDraftWhileRereadIsPendingOnReturn', async () => {
    const state = serve()
    const { user } = renderAppAt(SHARING)
    expect(await limitField()).toHaveValue('10')
    const reread = deferred()
    server.use(
      graphql.query<ShareCodeLimitSettingQuery>(
        'ShareCodeLimitSetting',
        async () => {
          await reread.promise
          return HttpResponse.json({
            data: { shareCodeLimitSetting: { ...state.limit, codes: 12 } },
          })
        },
        { once: true },
      ),
    )
    await returnToSharing(user)
    await enterLimit(user, '30')
    expect(saveLimit()).toBeDisabled()
    reread.resolve()
    await waitFor(() => expect(saveLimit()).toBeEnabled())
    expect(await limitField()).toHaveValue('30')
    await user.click(saveLimit())
    await waitFor(() => expect(state.limitChanges).toEqual([30]))
  })

  it('shouldIgnoreRetryWhileSaveIsInFlight', async () => {
    const state = serve()
    const { user } = renderAppAt(SHARING)
    expect(await limitField()).toHaveValue('10')
    server.use(
      graphql.query(
        'ShareCodeLimitSetting',
        () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
        { once: true },
      ),
    )
    await returnToSharing(user)
    await screen.findByText("Couldn't load the share code limit again.")
    const answer = deferred()
    server.use(
      graphql.mutation<ChangeShareCodeLimitMutation, ChangeShareCodeLimitMutationVariables>(
        'ChangeShareCodeLimit',
        async ({ variables }) => {
          state.limitChanges.push(variables.input.codes)
          await answer.promise
          state.limit = { ...state.limit, codes: variables.input.codes }
          return HttpResponse.json({
            data: {
              changeShareCodeLimit: { shareCodeLimitSetting: state.limit, userErrors: [] },
            },
          })
        },
        { once: true },
      ),
    )
    await enterLimit(user, '30')
    await user.click(saveLimit())
    await waitFor(() => expect(state.limitChanges).toEqual([30]))
    const readsBeforeRetry = state.limitReads
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    answer.resolve()
    await waitFor(async () => expect(await limitField()).toHaveValue('30'))
    expect(state.limitReads).toBe(readsBeforeRetry)
  })

  it.each([
    { session: 'that of an Account that is not a ServerAdmin', me: meFixture() },
    {
      session: 'bound to a TV',
      me: meFixture({ serverAdmin: true, scope: 'profile', deviceBound: true }),
    },
  ])('shouldReadNoSettingWhenTheSessionIs($session)', async ({ me }) => {
    const state = serve({ me })
    renderAppAt(SHARING)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server settings are available to server admins',
    )
    expect(state.limitReads).toBe(0)
  })
})
