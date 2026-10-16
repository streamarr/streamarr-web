import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  ChangeEncoderPresetMutation,
  ChangeEncoderPresetMutationVariables,
  EncoderPresetSettingFieldsFragment,
  EncoderPresetSettingQuery,
} from '../../graphql/generated/graphql'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

const ADMIN = meFixture({ scope: 'profile', serverAdmin: true })
const ENCODING = '/settings/server/encoding'
const SAVED_AUTOMATIC: EncoderPresetSettingFieldsFragment = {
  __typename: 'EncoderPresetSetting',
  preset: 'AUTOMATIC',
  automatic: {
    __typename: 'AutomaticEncoderPresets',
    h264: 'FASTER',
    hevc: 'VERYFAST',
    av1: 'FASTER',
  },
}

function serve(setting = SAVED_AUTOMATIC, me = ADMIN) {
  const state = { setting, settingReads: 0, changes: [] as string[] }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('AdminLibraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query<EncoderPresetSettingQuery>('EncoderPresetSetting', () => {
      state.settingReads++
      return HttpResponse.json({ data: { encoderPresetSetting: state.setting } })
    }),
    graphql.mutation<ChangeEncoderPresetMutation, ChangeEncoderPresetMutationVariables>(
      'ChangeEncoderPreset',
      ({ variables }) => {
        state.changes.push(variables.input.preset)
        state.setting = {
          ...state.setting,
          preset: variables.input.preset as EncoderPresetSettingFieldsFragment['preset'],
        }
        return HttpResponse.json({
          data: { changeEncoderPreset: { encoderPresetSetting: state.setting, userErrors: [] } },
        })
      },
    ),
  )
  return state
}

async function presetSelect() {
  return screen.findByRole('combobox', { name: 'Encoder preset' })
}

// Under jsdom, Mantine's open dropdown keeps display: none, so its options are hidden from the
// accessibility tree. The browser spec chooses from the visible list.
async function choosePreset(user: UserEvent, name: string) {
  await user.click(await presetSelect())
  await user.click(screen.getByRole('option', { name, hidden: true }))
}

describe('encoding settings', () => {
  it('shouldSavePresetWhenAdminChoosesOne', async () => {
    const state = serve()
    const { user } = renderAppAt(ENCODING)
    await choosePreset(user, 'medium')
    await waitFor(() => expect(state.changes).toEqual(['MEDIUM']))
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Encoder preset' })).toHaveValue('medium'),
    )
  })

  it('shouldShowAutomaticWhenNothingIsSaved', async () => {
    serve()
    renderAppAt(ENCODING)
    expect(await presetSelect()).toHaveValue('Automatic')
    expect(screen.getByRole('heading', { level: 1, name: 'Encoding' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Faster presets start playback sooner and fit more encodes on a worker. Slower presets give a better picture at the same bitrate. A change reaches only quality levels that start afterwards. A quality level that has already started keeps its preset, even after a seek.',
      ),
    ).toBeInTheDocument()
  })

  it('shouldListAutomaticFirstThenPresetsFromFastestToSlowestWhenSelectOpens', async () => {
    serve()
    const { user } = renderAppAt(ENCODING)
    await user.click(await presetSelect())
    const options = screen.getAllByRole('option', { hidden: true })
    expect(options.map((option) => option.textContent)).toEqual([
      'Automatic',
      'superfast',
      'veryfast',
      'faster',
      'fast',
      'medium',
      'slow',
      'slower',
      'veryslow',
    ])
  })

  it.each([
    {
      automatic: { h264: 'FASTER', hevc: 'VERYFAST', av1: 'FASTER' },
      line: 'Automatic uses faster for H.264 and AV1, and veryfast for HEVC.',
    },
    {
      automatic: { h264: 'FAST', hevc: 'FAST', av1: 'FAST' },
      line: 'Automatic uses fast for H.264, HEVC and AV1.',
    },
    {
      automatic: { h264: 'FASTER', hevc: 'VERYFAST', av1: 'MEDIUM' },
      line: 'Automatic uses faster for H.264, veryfast for HEVC, and medium for AV1.',
    },
  ] as const)('shouldNameWhatAutomaticUsesForEachCodec', async ({ automatic, line }) => {
    serve({
      ...SAVED_AUTOMATIC,
      automatic: { __typename: 'AutomaticEncoderPresets', ...automatic },
    })
    renderAppAt(ENCODING)
    expect(await screen.findByText(line)).toBeInTheDocument()
  })

  it('shouldSaveAutomaticWhenAdminChoosesAutomaticAgain', async () => {
    const state = serve({ ...SAVED_AUTOMATIC, preset: 'MEDIUM' })
    const { user } = renderAppAt(ENCODING)
    const select = await presetSelect()
    expect(select).toHaveValue('medium')
    await choosePreset(user, 'Automatic')
    await waitFor(() => expect(state.changes).toEqual(['AUTOMATIC']))
    await waitFor(() => expect(select).toHaveValue('Automatic'))
  })

  it('shouldShowServerMessageAndKeepSavedSettingWhenServerRefusesChange', async () => {
    const state = serve()
    server.use(
      graphql.mutation<ChangeEncoderPresetMutation, ChangeEncoderPresetMutationVariables>(
        'ChangeEncoderPreset',
        ({ variables }) => {
          state.changes.push(variables.input.preset)
          return HttpResponse.json({
            data: {
              changeEncoderPreset: {
                encoderPresetSetting: null,
                userErrors: [
                  {
                    __typename: 'UnknownEncoderPresetError',
                    message: 'The server does not know that encoder preset.',
                    inputPath: ['preset'],
                  },
                ],
              },
            },
          })
        },
      ),
    )
    const { user } = renderAppAt(ENCODING)
    const select = await presetSelect()
    await choosePreset(user, 'slower')
    expect(
      await screen.findByText('The server does not know that encoder preset.'),
    ).toBeInTheDocument()
    expect(select).toHaveAccessibleDescription(
      expect.stringContaining('The server does not know that encoder preset.'),
    )
    expect(select).toHaveValue('Automatic')
    expect(state.changes).toEqual(['SLOWER'])
  })

  it('shouldShowFailureAndKeepSavedSettingWhenChangeCannotBeConfirmed', async () => {
    serve()
    server.use(
      graphql.mutation('ChangeEncoderPreset', () =>
        HttpResponse.json({ errors: [{ message: 'offline' }] }),
      ),
    )
    const { user } = renderAppAt(ENCODING)
    const select = await presetSelect()
    await choosePreset(user, 'fast')
    expect(
      await screen.findByText(
        "Couldn't confirm the change. Refresh the page to check the saved preset before trying again.",
      ),
    ).toBeInTheDocument()
    expect(select).toHaveValue('Automatic')
  })

  it('shouldChoosePresetWithKeyboardWhenSelectHasFocus', async () => {
    const state = serve()
    const { user } = renderAppAt(ENCODING)
    const select = await presetSelect()
    select.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    await waitFor(() => expect(state.changes).toEqual(['SUPERFAST']))
    await waitFor(() => expect(select).toHaveValue('superfast'))
  })

  it('shouldShowSettingSavedElsewhereWhenAdminReturnsToEncoding', async () => {
    const state = serve()
    const { user } = renderAppAt(ENCODING)
    expect(await presetSelect()).toHaveValue('Automatic')
    const rail = screen.getByRole('navigation', { name: 'Server settings' })
    await user.click(within(rail).getByRole('link', { name: 'Libraries' }))
    await screen.findByRole('region', { name: 'Library administration' })
    state.setting = { ...state.setting, preset: 'SLOW' }
    await user.click(within(rail).getByRole('link', { name: 'Encoding' }))
    await waitFor(async () => expect(await presetSelect()).toHaveValue('slow'))
  })

  it('shouldOfferRetryAndKeepLastSettingWhenRereadFailsOnReturn', async () => {
    const state = serve({ ...SAVED_AUTOMATIC, preset: 'MEDIUM' })
    const { user } = renderAppAt(ENCODING)
    expect(await presetSelect()).toHaveValue('medium')
    const rail = screen.getByRole('navigation', { name: 'Server settings' })
    await user.click(within(rail).getByRole('link', { name: 'Libraries' }))
    await screen.findByRole('region', { name: 'Library administration' })
    server.use(
      graphql.query(
        'EncoderPresetSetting',
        () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
        { once: true },
      ),
    )
    await user.click(within(rail).getByRole('link', { name: 'Encoding' }))
    expect(await screen.findByText("Couldn't load the latest encoder preset.")).toBeInTheDocument()
    expect(await presetSelect()).toHaveValue('medium')
    state.setting = { ...state.setting, preset: 'SLOW' }
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(async () => expect(await presetSelect()).toHaveValue('slow'))
    expect(screen.queryByText("Couldn't load the latest encoder preset.")).not.toBeInTheDocument()
  })

  it('shouldKeepNewerSettingWhenEarlierChangeAnswersAfterAdminReturns', async () => {
    const state = serve()
    let answerFirstChange = () => {}
    const firstChangeAnswered = new Promise<void>((resolve) => {
      answerFirstChange = resolve
    })
    server.use(
      graphql.mutation<ChangeEncoderPresetMutation, ChangeEncoderPresetMutationVariables>(
        'ChangeEncoderPreset',
        async () => {
          state.changes.push('MEDIUM')
          await firstChangeAnswered
          return HttpResponse.json({
            data: {
              changeEncoderPreset: {
                encoderPresetSetting: { ...state.setting, preset: 'MEDIUM' },
                userErrors: [],
              },
            },
          })
        },
        { once: true },
      ),
    )
    const { user } = renderAppAt(ENCODING)
    await choosePreset(user, 'medium')
    await waitFor(() => expect(state.changes).toEqual(['MEDIUM']))
    const rail = screen.getByRole('navigation', { name: 'Server settings' })
    await user.click(within(rail).getByRole('link', { name: 'Libraries' }))
    await screen.findByRole('region', { name: 'Library administration' })
    await user.click(within(rail).getByRole('link', { name: 'Encoding' }))
    await choosePreset(user, 'fast')
    await waitFor(async () => expect(await presetSelect()).toHaveValue('fast'))
    expect(state.changes).toEqual(['MEDIUM', 'FAST'])
    const firstChangeDelivered = new Promise<void>((resolve) => {
      const delivered = () => {
        server.events.removeListener('response:mocked', delivered)
        resolve()
      }
      server.events.on('response:mocked', delivered)
    })
    answerFirstChange()
    await firstChangeDelivered
    await new Promise((resolve) => setTimeout(resolve))
    expect(await presetSelect()).toHaveValue('fast')
  })

  it('shouldShowSavedPresetWhenServerSendsOneThisClientDoesNotKnow', async () => {
    serve({
      ...SAVED_AUTOMATIC,
      preset: 'PLACEBO' as EncoderPresetSettingFieldsFragment['preset'],
    })
    renderAppAt(ENCODING)
    expect(await presetSelect()).toHaveValue('placebo')
  })

  it('shouldRetryReadingSettingWhenFirstReadFails', async () => {
    const state = serve()
    server.use(
      graphql.query(
        'EncoderPresetSetting',
        () => HttpResponse.json({ errors: [{ message: 'offline' }] }),
        { once: true },
      ),
    )
    const { user } = renderAppAt(ENCODING)
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await presetSelect()).toHaveValue('Automatic')
    expect(state.settingReads).toBe(1)
  })

  it('shouldShowServerSentenceWhenFirstReadFailsWithCode', async () => {
    serve()
    server.use(
      graphql.query('EncoderPresetSetting', () =>
        HttpResponse.json({
          errors: [
            { message: 'Settings storage is offline.', extensions: { code: 'UNAVAILABLE' } },
          ],
        }),
      ),
    )
    renderAppAt(ENCODING)
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings storage is offline.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shouldMarkEncodingAsCurrentSectionWhenEncodingIsOpen', async () => {
    serve()
    const { user, router } = renderAppAt('/settings/server/libraries')
    const rail = await screen.findByRole('navigation', { name: 'Server settings' })
    await user.click(within(rail).getByRole('link', { name: 'Encoding' }))
    await presetSelect()
    expect(router.state.location.pathname).toBe(ENCODING)
    expect(within(rail).getByRole('link', { name: 'Encoding' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(rail).getByRole('link', { name: 'Libraries' })).not.toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByRole('region', { name: 'Encoding' })).toBeInTheDocument()
  })

  it('shouldRejectIneligibleVisitBeforeReadingSettingWhenNotServerAdmin', async () => {
    const state = serve(undefined, { ...ADMIN, serverAdmin: false })
    renderAppAt(ENCODING)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server settings are available to server admins',
    )
    expect(state.settingReads).toBe(0)
  })
})
