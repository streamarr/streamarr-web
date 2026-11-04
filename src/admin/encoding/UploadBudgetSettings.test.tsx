import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  ChangeUploadBudgetMutation,
  ChangeUploadBudgetMutationVariables,
  EncoderPresetSettingQuery,
  UploadBudgetSettingFieldsFragment,
  UploadBudgetSettingQuery,
} from '../../graphql/generated/graphql'
import { deferred } from '../../test/deferred'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

const ENCODING = '/settings/server/encoding'
const OFF: UploadBudgetSettingFieldsFragment = {
  __typename: 'UploadBudgetSetting',
  internetUploadMegabitsPerSecond: null,
  streamSharePercent: 80,
  streamShareMegabitsPerSecond: null,
  minimumInternetUploadMegabitsPerSecond: 1,
  maximumInternetUploadMegabitsPerSecond: 10_000,
}
const DESCRIPTION =
  "From a speed test of the server's internet connection. Every viewer who isn't on your home network counts against it. When those streams would use more than their share, new streams offer fewer qualities. The budget never blocks playback or direct play. Leave the field empty to turn it off."

function on(megabitsPerSecond: number, share: number): UploadBudgetSettingFieldsFragment {
  return {
    ...OFF,
    internetUploadMegabitsPerSecond: megabitsPerSecond,
    streamShareMegabitsPerSecond: share,
  }
}

// The server owns the share: each save answers with the share it computed for the saved speed.
function serve(setting = OFF) {
  const state = { setting, changes: [] as (number | null | undefined)[], reads: 0 }
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
    graphql.query<UploadBudgetSettingQuery>('UploadBudgetSetting', () => {
      state.reads++
      return HttpResponse.json({ data: { uploadBudgetSetting: state.setting } })
    }),
    graphql.mutation<ChangeUploadBudgetMutation, ChangeUploadBudgetMutationVariables>(
      'ChangeUploadBudget',
      ({ variables }) => {
        const speed = variables.input.internetUploadMegabitsPerSecond
        state.changes.push(speed)
        state.setting = typeof speed === 'number' ? on(speed, speed * 0.8) : OFF
        return HttpResponse.json({
          data: { changeUploadBudget: { uploadBudgetSetting: state.setting, userErrors: [] } },
        })
      },
    ),
  )
  return state
}

async function speedField() {
  return screen.findByRole('textbox', { name: 'Internet upload speed' })
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save internet upload speed' })
}

async function enterSpeed(user: UserEvent, speed: string) {
  const field = await speedField()
  await user.clear(field)
  if (speed) await user.type(field, speed)
  return field
}

// Leaves for Libraries and comes back, so the page starts from the cached setting and reads again.
async function returnToEncoding(user: UserEvent) {
  const rail = screen.getByRole('navigation', { name: 'Server settings' })
  await user.click(within(rail).getByRole('link', { name: 'Libraries' }))
  await screen.findByRole('region', { name: 'Library administration' })
  await user.click(within(rail).getByRole('link', { name: 'Encoding' }))
}

describe('upload budget settings', () => {
  it('shouldShowTheBudgetOffWhenNoSpeedIsSaved', async () => {
    serve()
    renderAppAt(ENCODING)
    const field = await speedField()
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', 'Off')
    expect(field).toHaveAccessibleDescription(expect.stringContaining(DESCRIPTION))
    expect(screen.getByText('Mb/s')).toBeInTheDocument()
    expect(screen.getByText('Off: streams use as much upload as they need.')).toBeInTheDocument()
    expect(screen.getByText('From 1 to 10,000 Mb/s.')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it.each([
    { speed: 20, share: 16, line: 'Streams use up to 80%: 16 of 20 Mb/s.' },
    { speed: 21, share: 16.8, line: 'Streams use up to 80%: 16.8 of 21 Mb/s.' },
    { speed: 10_000, share: 8_000, line: 'Streams use up to 80%: 8,000 of 10,000 Mb/s.' },
  ])('shouldShowTheStreamShareWhenASpeedIsSaved($line)', async ({ speed, share, line }) => {
    serve(on(speed, share))
    renderAppAt(ENCODING)
    expect(await speedField()).toHaveValue(String(speed))
    expect(screen.getByText(line)).toBeInTheDocument()
  })

  it('shouldNameTheShareAndRangeTheServerSends', async () => {
    serve({
      ...on(40, 30),
      streamSharePercent: 75,
      minimumInternetUploadMegabitsPerSecond: 5,
      maximumInternetUploadMegabitsPerSecond: 500,
    })
    renderAppAt(ENCODING)
    await speedField()
    expect(screen.getByText('Streams use up to 75%: 30 of 40 Mb/s.')).toBeInTheDocument()
    expect(screen.getByText('From 5 to 500 Mb/s.')).toBeInTheDocument()
  })

  it('shouldSaveTheEnteredSpeedAndShowTheShareTheServerAnswers', async () => {
    const state = serve()
    const { user } = renderAppAt(ENCODING)
    await enterSpeed(user, '20')
    await user.click(saveButton())
    await waitFor(() => expect(state.changes).toEqual([20]))
    expect(await screen.findByText('Streams use up to 80%: 16 of 20 Mb/s.')).toBeInTheDocument()
    expect(await speedField()).toHaveValue('20')
    expect(saveButton()).toBeDisabled()
  })

  it('shouldTurnTheBudgetOffWhenAdminEmptiesTheFieldAndSaves', async () => {
    const state = serve(on(20, 16))
    const { user } = renderAppAt(ENCODING)
    await enterSpeed(user, '')
    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())
    await waitFor(() => expect(state.changes).toEqual([null]))
    expect(
      await screen.findByText('Off: streams use as much upload as they need.'),
    ).toBeInTheDocument()
    expect(await speedField()).toHaveValue('')
  })

  it.each([
    { saved: OFF, entered: '', reason: 'the budget is off and the field is empty' },
    { saved: on(20, 16), entered: '20', reason: 'the entered speed is the saved one' },
  ])('shouldKeepSaveDisabledWhenNothingChanges($reason)', async ({ saved, entered }) => {
    serve(saved)
    const { user } = renderAppAt(ENCODING)
    await enterSpeed(user, entered)
    expect(saveButton()).toBeDisabled()
  })

  it('shouldShowTheServerMessageAndKeepTheEntryWhenTheServerRefusesTheSpeed', async () => {
    const state = serve()
    server.use(
      graphql.mutation<ChangeUploadBudgetMutation, ChangeUploadBudgetMutationVariables>(
        'ChangeUploadBudget',
        ({ variables }) => {
          state.changes.push(variables.input.internetUploadMegabitsPerSecond)
          return HttpResponse.json({
            data: {
              changeUploadBudget: {
                uploadBudgetSetting: null,
                userErrors: [
                  {
                    __typename: 'UploadBudgetOutOfRangeError',
                    message: 'Enter an upload speed from 1 to 10000 Mb/s.',
                    inputPath: ['internetUploadMegabitsPerSecond'],
                  },
                ],
              },
            },
          })
        },
      ),
    )
    const { user } = renderAppAt(ENCODING)
    const field = await enterSpeed(user, '20000')
    await user.click(saveButton())
    expect(
      await screen.findByText('Enter an upload speed from 1 to 10000 Mb/s.'),
    ).toBeInTheDocument()
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('Enter an upload speed from 1 to 10000 Mb/s.'),
    )
    expect(field).toHaveValue('20000')
    expect(state.changes).toEqual([20_000])
    expect(screen.getByText('Off: streams use as much upload as they need.')).toBeInTheDocument()
  })

  it('shouldShowAFailureWhenTheChangeCannotBeConfirmed', async () => {
    serve()
    server.use(
      graphql.mutation('ChangeUploadBudget', () =>
        HttpResponse.json({ errors: [{ message: 'offline' }] }),
      ),
    )
    const { user } = renderAppAt(ENCODING)
    await enterSpeed(user, '20')
    await user.click(saveButton())
    expect(
      await screen.findByText(
        "Couldn't confirm the change. Refresh the page to check the saved upload speed before trying again.",
      ),
    ).toBeInTheDocument()
  })

  it('shouldOfferRetryWhenTheBudgetCannotBeLoaded', async () => {
    const state = serve(on(20, 16))
    server.use(
      graphql.query(
        'UploadBudgetSetting',
        () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
        { once: true },
      ),
    )
    const { user } = renderAppAt(ENCODING)
    expect(await screen.findByText("Couldn't load the upload budget.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await speedField()).toHaveValue('20')
    expect(state.reads).toBe(1)
  })

  it('shouldShowTheSavedSpeedFromTheCacheWhenAdminReturnsBeforeTheRereadAnswers', async () => {
    const state = serve()
    const { user } = renderAppAt(ENCODING)
    await enterSpeed(user, '20')
    await user.click(saveButton())
    await waitFor(() => expect(saveButton()).toBeDisabled())
    const readsAfterSave = state.reads
    const reread = deferred()
    server.use(
      graphql.query<UploadBudgetSettingQuery>(
        'UploadBudgetSetting',
        async () => {
          state.reads++
          await reread.promise
          return HttpResponse.json({ data: { uploadBudgetSetting: state.setting } })
        },
        { once: true },
      ),
    )
    await returnToEncoding(user)
    expect(await speedField()).toHaveValue('20')
    expect(screen.getByText('Streams use up to 80%: 16 of 20 Mb/s.')).toBeInTheDocument()
    await waitFor(() => expect(state.reads).toBe(readsAfterSave + 1))
    reread.resolve()
  })

  it('shouldKeepTheEntryAndHoldSaveWhileARereadIsPending', async () => {
    const state = serve(on(20, 16))
    const { user } = renderAppAt(ENCODING)
    expect(await speedField()).toHaveValue('20')
    const reread = deferred()
    server.use(
      graphql.query<UploadBudgetSettingQuery>(
        'UploadBudgetSetting',
        async () => {
          await reread.promise
          return HttpResponse.json({ data: { uploadBudgetSetting: on(50, 40) } })
        },
        { once: true },
      ),
    )
    await returnToEncoding(user)
    await enterSpeed(user, '30')
    expect(saveButton()).toBeDisabled()
    reread.resolve()
    await waitFor(() =>
      expect(screen.getByText('Streams use up to 80%: 40 of 50 Mb/s.')).toBeInTheDocument(),
    )
    expect(await speedField()).toHaveValue('30')
    expect(saveButton()).toBeEnabled()
    expect(state.changes).toEqual([])
  })

  it('shouldShowARereadFailureAboveTheCachedSpeed', async () => {
    serve(on(20, 16))
    const { user } = renderAppAt(ENCODING)
    expect(await speedField()).toHaveValue('20')
    server.use(
      graphql.query(
        'UploadBudgetSetting',
        () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
        { once: true },
      ),
    )
    await returnToEncoding(user)
    expect(await screen.findByText("Couldn't load the latest upload budget.")).toBeInTheDocument()
    expect(await speedField()).toHaveValue('20')
  })

  it('shouldIgnoreRetryWhileASaveIsInFlight', async () => {
    const state = serve(on(20, 16))
    const { user } = renderAppAt(ENCODING)
    expect(await speedField()).toHaveValue('20')
    server.use(
      graphql.query(
        'UploadBudgetSetting',
        () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
        { once: true },
      ),
    )
    await returnToEncoding(user)
    const retry = await screen.findByRole('button', { name: 'Retry' })
    const answer = deferred()
    server.use(
      graphql.mutation<ChangeUploadBudgetMutation, ChangeUploadBudgetMutationVariables>(
        'ChangeUploadBudget',
        async ({ variables }) => {
          state.changes.push(variables.input.internetUploadMegabitsPerSecond)
          await answer.promise
          state.setting = on(30, 24)
          return HttpResponse.json({
            data: { changeUploadBudget: { uploadBudgetSetting: state.setting, userErrors: [] } },
          })
        },
        { once: true },
      ),
    )
    await enterSpeed(user, '30')
    await user.click(saveButton())
    await waitFor(() => expect(state.changes).toEqual([30]))
    const readsDuringSave = state.reads
    await user.click(retry)
    expect(state.reads).toBe(readsDuringSave)
    answer.resolve()
    expect(await screen.findByText('Streams use up to 80%: 24 of 30 Mb/s.')).toBeInTheDocument()
  })
})
