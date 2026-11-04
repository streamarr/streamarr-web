import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  ChangeIdleSegmentRetentionMutation,
  ChangeIdleSegmentRetentionMutationVariables,
  EncoderPresetSettingQuery,
  IdleSegmentRetentionSettingFieldsFragment,
  IdleSegmentRetentionSettingQuery,
} from '../../graphql/generated/graphql'
import { deferred } from '../../test/deferred'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

const ENCODING = '/settings/server/encoding'
const SAVED_ONE_HOUR: IdleSegmentRetentionSettingFieldsFragment = {
  __typename: 'IdleSegmentRetentionSetting',
  minutes: 60,
  minimumMinutes: 5,
  maximumMinutes: 10_080,
}

function serve(setting = SAVED_ONE_HOUR) {
  const state = { setting, changes: [] as number[] }
  server.use(
    graphql.query('Me', () =>
      HttpResponse.json({ data: { me: meFixture({ scope: 'profile', serverAdmin: true }) } }),
    ),
    graphql.query('AdminLibraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query<EncoderPresetSettingQuery>('EncoderPresetSetting', () =>
      HttpResponse.json({
        data: {
          encoderPresetSetting: {
            __typename: 'EncoderPresetSetting',
            preset: 'AUTOMATIC',
            automatic: {
              __typename: 'AutomaticEncoderPresets',
              h264: 'FASTER',
              hevc: 'VERYFAST',
              av1: 'FASTER',
            },
          },
        },
      }),
    ),
    graphql.query<IdleSegmentRetentionSettingQuery>('IdleSegmentRetentionSetting', () =>
      HttpResponse.json({ data: { idleSegmentRetentionSetting: state.setting } }),
    ),
    graphql.mutation<
      ChangeIdleSegmentRetentionMutation,
      ChangeIdleSegmentRetentionMutationVariables
    >('ChangeIdleSegmentRetention', ({ variables }) => {
      state.changes.push(variables.input.minutes)
      state.setting = { ...state.setting, minutes: variables.input.minutes }
      return HttpResponse.json({
        data: {
          changeIdleSegmentRetention: {
            idleSegmentRetentionSetting: state.setting,
            userErrors: [],
          },
        },
      })
    }),
  )
  return state
}

async function retentionField() {
  return screen.findByRole('textbox', { name: 'Keep idle segments for' })
}

// Leaves for Libraries and comes back, so the page starts from the cached setting and reads again.
async function returnToEncoding(user: UserEvent) {
  const rail = screen.getByRole('navigation', { name: 'Server settings' })
  await user.click(within(rail).getByRole('link', { name: 'Libraries' }))
  await screen.findByRole('region', { name: 'Library administration' })
  await user.click(within(rail).getByRole('link', { name: 'Encoding' }))
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save idle segment retention' })
}

describe('idle segment retention settings', () => {
  it('shouldShowSavedRetentionAndAllowedRangeWhenAdminOpensEncoding', async () => {
    serve()
    renderAppAt(ENCODING)
    expect(await retentionField()).toHaveValue('60')
    expect(screen.getByText('minutes')).toBeInTheDocument()
    expect(screen.getByText('From 5 minutes to 7 days.')).toBeInTheDocument()
    expect(
      screen.getByText(
        "How long the server keeps a stream's segments after the last request for them. When the segment folder's disk has less than a tenth free, the server deletes the oldest idle segments sooner.",
      ),
    ).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it.each([
    { minimumMinutes: 1, maximumMinutes: 120, range: 'From 1 minute to 2 hours.' },
    { minimumMinutes: 60, maximumMinutes: 1_440, range: 'From 1 hour to 1 day.' },
    { minimumMinutes: 90, maximumMinutes: 2_880, range: 'From 90 minutes to 2 days.' },
  ] as const)(
    'shouldNameAllowedRangeInLargestWholeUnitWhenServerSendsBounds($range)',
    async ({ minimumMinutes, maximumMinutes, range }) => {
      serve({ ...SAVED_ONE_HOUR, minimumMinutes, maximumMinutes })
      renderAppAt(ENCODING)
      await retentionField()
      expect(screen.getByText(range)).toBeInTheDocument()
    },
  )

  it('shouldSaveRetentionWhenAdminEntersMinutesAndSaves', async () => {
    const state = serve()
    const { user } = renderAppAt(ENCODING)
    const field = await retentionField()
    await user.clear(field)
    await user.type(field, '30')
    await user.click(saveButton())
    await waitFor(() => expect(state.changes).toEqual([30]))
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(await retentionField()).toHaveValue('30')
  })

  it('shouldKeepSaveDisabledWhenFieldIsEmpty', async () => {
    serve()
    const { user } = renderAppAt(ENCODING)
    const field = await retentionField()
    await user.clear(field)
    expect(saveButton()).toBeDisabled()
  })

  it('shouldShowServerMessageAndKeepSavedRetentionWhenServerRefusesChange', async () => {
    const state = serve()
    server.use(
      graphql.mutation<
        ChangeIdleSegmentRetentionMutation,
        ChangeIdleSegmentRetentionMutationVariables
      >('ChangeIdleSegmentRetention', ({ variables }) => {
        state.changes.push(variables.input.minutes)
        return HttpResponse.json({
          data: {
            changeIdleSegmentRetention: {
              idleSegmentRetentionSetting: null,
              userErrors: [
                {
                  __typename: 'IdleSegmentRetentionOutOfRangeError',
                  message: 'Choose from 5 to 10080 minutes.',
                  inputPath: ['minutes'],
                },
              ],
            },
          },
        })
      }),
    )
    const { user } = renderAppAt(ENCODING)
    const field = await retentionField()
    await user.clear(field)
    await user.type(field, '4')
    await user.click(saveButton())
    expect(await screen.findByText('Choose from 5 to 10080 minutes.')).toBeInTheDocument()
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('Choose from 5 to 10080 minutes.'),
    )
    expect(state.changes).toEqual([4])
    expect(state.setting.minutes).toBe(60)
  })

  it('shouldShowFailureWhenChangeCannotBeConfirmed', async () => {
    serve()
    server.use(
      graphql.mutation('ChangeIdleSegmentRetention', () =>
        HttpResponse.json({ errors: [{ message: 'offline' }] }),
      ),
    )
    const { user } = renderAppAt(ENCODING)
    const field = await retentionField()
    await user.clear(field)
    await user.type(field, '120')
    await user.click(saveButton())
    expect(
      await screen.findByText(
        "Couldn't confirm the change. Refresh the page to check the saved retention before trying again.",
      ),
    ).toBeInTheDocument()
  })

  it('shouldOfferRetryWhenRetentionCannotBeLoaded', async () => {
    const state = serve()
    let reads = 0
    server.use(
      graphql.query<IdleSegmentRetentionSettingQuery>('IdleSegmentRetentionSetting', () => {
        reads++
        if (reads === 1) return HttpResponse.json({ errors: [{ message: 'offline' }] })
        return HttpResponse.json({ data: { idleSegmentRetentionSetting: state.setting } })
      }),
    )
    const { user } = renderAppAt(ENCODING)
    expect(await screen.findByText("Couldn't load the idle segment retention.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await retentionField()).toHaveValue('60')
  })

  it('shouldKeepSaveDisabledAndKeepDraftWhileRereadIsPendingOnReturn', async () => {
    const state = serve()
    const { user } = renderAppAt(ENCODING)
    expect(await retentionField()).toHaveValue('60')
    const reread = deferred()
    server.use(
      graphql.query<IdleSegmentRetentionSettingQuery>(
        'IdleSegmentRetentionSetting',
        async () => {
          await reread.promise
          return HttpResponse.json({
            data: { idleSegmentRetentionSetting: { ...state.setting, minutes: 120 } },
          })
        },
        { once: true },
      ),
    )
    await returnToEncoding(user)
    const field = await retentionField()
    await user.clear(field)
    await user.type(field, '30')
    expect(saveButton()).toBeDisabled()
    reread.resolve()
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(await retentionField()).toHaveValue('30')
    await user.click(saveButton())
    await waitFor(() => expect(state.changes).toEqual([30]))
  })

  it('shouldShowRereadFailureBesideCachedRetentionWhenRereadFailsOnReturn', async () => {
    const state = serve()
    const { user } = renderAppAt(ENCODING)
    expect(await retentionField()).toHaveValue('60')
    server.use(
      graphql.query(
        'IdleSegmentRetentionSetting',
        () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
        { once: true },
      ),
    )
    await returnToEncoding(user)
    expect(
      await screen.findByText("Couldn't load the latest idle segment retention."),
    ).toBeInTheDocument()
    expect(await retentionField()).toHaveValue('60')
    state.setting = { ...state.setting, minutes: 90 }
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(async () => expect(await retentionField()).toHaveValue('90'))
    expect(
      screen.queryByText("Couldn't load the latest idle segment retention."),
    ).not.toBeInTheDocument()
  })
})
