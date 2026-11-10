import { act, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  Language,
  LanguageSettingsQuery,
  ProfileLanguagePreferencesFieldsFragment,
  SetLanguagePreferencesInput,
  SetLanguagePreferencesMutation,
  SetLanguagePreferencesMutationVariables,
} from '../graphql/generated/graphql'
import { watchingConnection } from '../test/continueWatchingFixtures'
import {
  answerDelivered,
  answersThenHolds,
  comeBackOnline,
  networkFailure,
} from '../test/graphqlResponses'
import { meFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const LANGUAGES = '/settings/profile/languages'
const ME = meFixture({ scope: 'profile' })

function preferences(
  overrides: Partial<ProfileLanguagePreferencesFieldsFragment> = {},
): ProfileLanguagePreferencesFieldsFragment {
  return {
    __typename: 'ProfileLanguagePreferences',
    audioLanguages: ['JA', 'EN'],
    subtitleLanguage: 'EN',
    subtitleMode: 'FORCED',
    ...overrides,
  }
}

type Refusal = NonNullable<
  SetLanguagePreferencesMutation['setLanguagePreferences']
>['userErrors'][number]

function serve({
  saved = preferences(),
  refusal,
}: { saved?: ProfileLanguagePreferencesFieldsFragment | null; refusal?: Refusal } = {}) {
  const state = { saved, inputs: [] as SetLanguagePreferencesInput[] }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query<LanguageSettingsQuery>('LanguageSettings', () =>
      HttpResponse.json({
        data: { me: { __typename: 'Me', languagePreferences: state.saved } },
      }),
    ),
    graphql.mutation<SetLanguagePreferencesMutation, SetLanguagePreferencesMutationVariables>(
      'SetLanguagePreferences',
      ({ variables: { input } }) => {
        state.inputs.push(input)
        if (refusal) {
          return HttpResponse.json({
            data: { setLanguagePreferences: { languagePreferences: null, userErrors: [refusal] } },
          })
        }
        state.saved = {
          __typename: 'ProfileLanguagePreferences',
          audioLanguages: input.audioLanguages,
          subtitleLanguage: input.subtitleLanguage ?? null,
          subtitleMode: input.subtitleMode,
        }
        return HttpResponse.json({
          data: { setLanguagePreferences: { languagePreferences: state.saved, userErrors: [] } },
        })
      },
    ),
  )
  return state
}

async function audioLanguages(): Promise<string[]> {
  const list = await screen.findByRole('list', { name: 'Audio languages' })
  return within(list)
    .queryAllByRole('listitem')
    .map((item) => within(item).getByTestId('language-name').textContent ?? '')
}

// Under jsdom, Mantine's open dropdown keeps display: none, so its options are hidden from the
// accessibility tree.
async function choose(user: UserEvent, field: string, option: string) {
  await user.click(await screen.findByRole('combobox', { name: field }))
  await user.click(within(optionsOf(field)).getByRole('option', { name: option, hidden: true }))
}

function optionsOf(field: string): HTMLElement {
  return screen.getByRole('listbox', { name: field, hidden: true })
}

describe('language settings', () => {
  it('shouldShowTheProfileSettingsMenuWithLanguagesCurrentWhenTheScreenOpens', async () => {
    serve()
    renderAppAt(LANGUAGES)

    const menu = await screen.findByRole('navigation', { name: 'Profile settings' })
    expect(within(menu).getByRole('link', { name: 'Languages' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(screen.getByRole('region', { name: 'Languages' })).getByRole('heading', {
        level: 1,
        name: 'Languages',
      }),
    ).toBeVisible()
  })

  it('shouldOpenLanguagesWhenProfileSettingsOpensWithoutASection', async () => {
    serve()
    const { router } = renderAppAt('/settings/profile')

    expect(await screen.findByRole('heading', { level: 1, name: 'Languages' })).toBeVisible()
    expect(router.state.location.pathname).toBe(LANGUAGES)
  })

  it('shouldShowTheProfilesLanguagesWhenTheScreenOpens', async () => {
    serve()
    renderAppAt(LANGUAGES)

    expect(await screen.findByRole('heading', { level: 1, name: 'Languages' })).toBeVisible()
    expect(await audioLanguages()).toEqual(['Japanese', 'English'])
    expect(screen.getByRole('combobox', { name: 'Subtitle language' })).toHaveValue('English')
    expect(screen.getByRole('radio', { name: /^Forced only/ })).toBeChecked()
  })

  it('shouldSaveTheLanguageLastInTheListWhenTheViewerAddsOne', async () => {
    const state = serve()
    const { user } = renderAppAt(LANGUAGES)

    await choose(user, 'Add an audio language', 'French')

    await waitFor(() =>
      expect(state.inputs).toEqual([
        { audioLanguages: ['JA', 'EN', 'FR'], subtitleLanguage: 'EN', subtitleMode: 'FORCED' },
      ]),
    )
    await waitFor(async () =>
      expect(await audioLanguages()).toEqual(['Japanese', 'English', 'French']),
    )
  })

  it('shouldOfferOnlyLanguagesTheListLacksWhenTheViewerAddsOne', async () => {
    serve()
    const { user } = renderAppAt(LANGUAGES)

    await user.click(await screen.findByRole('combobox', { name: 'Add an audio language' }))

    const options = within(optionsOf('Add an audio language'))
    expect(options.getByRole('option', { name: 'French', hidden: true })).toBeInTheDocument()
    expect(options.queryByRole('option', { name: 'Japanese', hidden: true })).toBeNull()
  })

  it('shouldSaveTheNewOrderWhenTheViewerMovesALanguageUp', async () => {
    const state = serve()
    const { user } = renderAppAt(LANGUAGES)

    await user.click(await screen.findByRole('button', { name: 'Move English up' }))

    await waitFor(() =>
      expect(state.inputs.map((input) => input.audioLanguages)).toEqual([['EN', 'JA']]),
    )
    await waitFor(async () => expect(await audioLanguages()).toEqual(['English', 'Japanese']))
  })

  it('shouldSaveTheNewOrderWhenTheViewerMovesALanguageDown', async () => {
    const state = serve()
    const { user } = renderAppAt(LANGUAGES)

    await user.click(await screen.findByRole('button', { name: 'Move Japanese down' }))

    await waitFor(() =>
      expect(state.inputs.map((input) => input.audioLanguages)).toEqual([['EN', 'JA']]),
    )
  })

  it('shouldOfferNoMoveBeyondTheEndsOfTheList', async () => {
    serve()
    renderAppAt(LANGUAGES)

    expect(await screen.findByRole('button', { name: 'Move Japanese up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move English down' })).toBeDisabled()
  })

  it('shouldSaveTheListWithoutALanguageWhenTheViewerRemovesIt', async () => {
    const state = serve()
    const { user } = renderAppAt(LANGUAGES)

    await user.click(await screen.findByRole('button', { name: 'Remove Japanese' }))

    await waitFor(() => expect(state.inputs.map((input) => input.audioLanguages)).toEqual([['EN']]))
    await waitFor(async () => expect(await audioLanguages()).toEqual(['English']))
  })

  it('shouldSayEachFileDecidesWhenTheListIsEmpty', async () => {
    serve({ saved: preferences({ audioLanguages: [] }) })
    renderAppAt(LANGUAGES)

    expect(await audioLanguages()).toEqual([])
    expect(
      screen.getByText('No audio languages. Each file plays its own default track.'),
    ).toBeVisible()
  })

  it('shouldOfferNoFurtherLanguageWhenTheListHoldsFive', async () => {
    serve({ saved: preferences({ audioLanguages: ['JA', 'EN', 'FR', 'DE', 'ES'] }) })
    renderAppAt(LANGUAGES)

    expect(await audioLanguages()).toHaveLength(5)
    expect(screen.queryByRole('combobox', { name: 'Add an audio language' })).toBeNull()
    expect(screen.getByText('A Profile keeps up to five audio languages.')).toBeVisible()
  })

  it('shouldListAnAudioLanguageNewerThanThisClientByItsTagWhenTheBrowserCannotReadIt', async () => {
    serve({ saved: preferences({ audioLanguages: ['JA', 'QAA_QTZ' as Language] }) })
    renderAppAt(LANGUAGES)

    expect(await audioLanguages()).toEqual(['Japanese', 'qaa-QTZ'])
  })

  it('shouldKeepShowingASubtitleLanguageNewerThanThisClientWhenItIsSaved', async () => {
    serve({ saved: preferences({ subtitleLanguage: 'FR_CA' as Language }) })
    const { user } = renderAppAt(LANGUAGES)

    const field = await screen.findByRole('combobox', { name: 'Subtitle language' })
    expect(field).toHaveValue('Canadian French')
    await user.click(field)
    expect(
      within(optionsOf('Subtitle language')).getByRole('option', {
        name: 'Canadian French',
        hidden: true,
      }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('shouldSaveTheSubtitleModeWhenTheViewerChoosesOne', async () => {
    const state = serve()
    const { user } = renderAppAt(LANGUAGES)

    await user.click(await screen.findByRole('radio', { name: /^Always/ }))

    await waitFor(() =>
      expect(state.inputs).toEqual([
        { audioLanguages: ['JA', 'EN'], subtitleLanguage: 'EN', subtitleMode: 'ALWAYS' },
      ]),
    )
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Always/ })).toBeChecked())
  })

  it('shouldSaveTheSubtitleLanguageWhenTheViewerChoosesOne', async () => {
    const state = serve()
    const { user } = renderAppAt(LANGUAGES)

    await choose(user, 'Subtitle language', 'Brazilian Portuguese')

    await waitFor(() =>
      expect(state.inputs.map((input) => input.subtitleLanguage)).toEqual(['PT_BR']),
    )
  })

  it('shouldSaveNoSubtitleLanguageWhenTheViewerChoosesNone', async () => {
    const state = serve()
    const { user } = renderAppAt(LANGUAGES)

    await choose(user, 'Subtitle language', 'None')

    await waitFor(() => expect(state.inputs.map((input) => input.subtitleLanguage)).toEqual([null]))
  })

  it('shouldShowTheServersWordsAndKeepTheSavedListWhenTheServerRefusesTheChange', async () => {
    const state = serve({
      refusal: {
        __typename: 'RepeatedAudioLanguageError',
        message: 'The list names English twice.',
        inputPath: ['input', 'audioLanguages', '1'],
      },
    })
    const { user } = renderAppAt(LANGUAGES)

    await user.click(await screen.findByRole('button', { name: 'Remove Japanese' }))

    expect(await screen.findByText('The list names English twice.')).toBeVisible()
    expect(state.inputs).toHaveLength(1)
    expect(await audioLanguages()).toEqual(['Japanese', 'English'])
  })

  it('shouldHoldEditsWhileAReturnToTheScreenReadsThePreferencesAgain', async () => {
    const state = serve()
    const answer = { me: { __typename: 'Me', languagePreferences: preferences() } }
    const reads = answersThenHolds(answer, answer)
    server.use(
      graphql.query('LanguageSettings', reads.resolver),
      graphql.query('Home', () =>
        HttpResponse.json({ data: { continueWatching: watchingConnection([]), libraries: [] } }),
      ),
    )
    const { user, router } = renderAppAt(LANGUAGES)
    await screen.findByRole('button', { name: 'Remove Japanese' })

    await act(() => router.navigate({ to: '/' }))
    await act(() => router.navigate({ to: LANGUAGES }))
    const remove = await screen.findByRole('button', { name: 'Remove Japanese' })
    await waitFor(() => expect(reads.calls).toBe(2))
    expect(remove).toBeDisabled()
    reads.release()

    await waitFor(() => expect(remove).toBeEnabled())
    await user.click(remove)
    await waitFor(() => expect(state.inputs.map((input) => input.audioLanguages)).toEqual([['EN']]))
  })

  it('shouldSaveNothingWhileAReadBesideTheScreenMayStillAnswerWithOlderPreferences', async () => {
    const state = serve()
    const answer = { me: { __typename: 'Me', languagePreferences: preferences() } }
    const reads = answersThenHolds(answer, answer)
    server.use(graphql.query('LanguageSettings', reads.resolver))
    const { user } = renderAppAt(LANGUAGES)
    await screen.findByRole('button', { name: 'Remove Japanese' })
    comeBackOnline()
    await waitFor(() => expect(reads.calls).toBe(2))

    await user.click(screen.getByRole('button', { name: 'Remove Japanese' }))
    const readAnswered = answerDelivered('LanguageSettings')
    reads.release()
    await readAnswered

    expect(state.inputs).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Remove Japanese' }))
    await waitFor(() => expect(state.inputs.map((input) => input.audioLanguages)).toEqual([['EN']]))
  })

  it('shouldSayTheChangeWasNotSavedWhenAReadBesideTheScreenHoldsIt', async () => {
    serve()
    const answer = { me: { __typename: 'Me', languagePreferences: preferences() } }
    const reads = answersThenHolds(answer, answer)
    server.use(graphql.query('LanguageSettings', reads.resolver))
    const { user } = renderAppAt(LANGUAGES)
    await screen.findByRole('button', { name: 'Remove Japanese' })
    comeBackOnline()
    await waitFor(() => expect(reads.calls).toBe(2))

    await user.click(screen.getByRole('button', { name: 'Remove Japanese' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Your languages were still loading, so that change wasn't saved.",
    )
    const readAnswered = answerDelivered('LanguageSettings')
    reads.release()
    await readAnswered
    await user.click(screen.getByRole('button', { name: 'Remove Japanese' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('shouldOfferNoChangeWhenTheNextProfilesPreferencesCannotBeRead', async () => {
    const state = serve()
    const { apolloClient } = renderAppAt(LANGUAGES)
    await screen.findByRole('button', { name: 'Remove Japanese' })
    server.use(graphql.query('LanguageSettings', () => networkFailure()))

    await act(async () => {
      await apolloClient.resetStore().catch(() => undefined)
    })

    expect(await screen.findByText("Couldn't load your languages.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Japanese' })).not.toBeInTheDocument()
    expect(state.inputs).toEqual([])
  })

  it('shouldSayTheChangeWasNotSavedWhenTheRequestFails', async () => {
    serve()
    server.use(graphql.mutation('SetLanguagePreferences', () => networkFailure()))
    const { user } = renderAppAt(LANGUAGES)

    await user.click(await screen.findByRole('button', { name: 'Remove Japanese' }))

    expect(await screen.findByText("Couldn't save your languages. Try again.")).toBeVisible()
    expect(await audioLanguages()).toEqual(['Japanese', 'English'])
  })

  it('shouldShowTheServersWordsWhenTheChangeFailsWithThem', async () => {
    serve()
    server.use(
      graphql.mutation('SetLanguagePreferences', () =>
        HttpResponse.json({
          errors: [{ message: 'Profile storage is offline.', extensions: { code: 'UNAVAILABLE' } }],
        }),
      ),
    )
    const { user } = renderAppAt(LANGUAGES)

    await user.click(await screen.findByRole('button', { name: 'Remove Japanese' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Profile storage is offline.')
    expect(await audioLanguages()).toEqual(['Japanese', 'English'])
  })

  it('shouldOfferRetryWhenThePreferencesCannotLoad', async () => {
    const state = serve()
    server.use(graphql.query('LanguageSettings', () => networkFailure(), { once: true }))
    const { user } = renderAppAt(LANGUAGES)

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await audioLanguages()).toEqual(['Japanese', 'English'])
    expect(state.inputs).toEqual([])
  })

  it('shouldAskForAProfileWhenNoneIsSelected', async () => {
    serve({ saved: null })
    renderAppAt(LANGUAGES)

    expect(await screen.findByText('Choose a Profile to set its languages.')).toBeVisible()
    expect(screen.queryByRole('list', { name: 'Audio languages' })).toBeNull()
  })
})

describe('language settings beside the profile menu', () => {
  it('shouldReadMeAndThePreferencesOnceWhenTheScreenOpens', async () => {
    serve()
    const reads = { me: 0, preferences: 0 }
    server.use(
      graphql.query('Me', () => {
        reads.me++
        return HttpResponse.json({ data: { me: ME } })
      }),
      graphql.query('LanguageSettings', () => {
        reads.preferences++
        return HttpResponse.json({
          data: { me: { __typename: 'Me', languagePreferences: preferences() } },
        })
      }),
    )
    renderAppAt(LANGUAGES)

    expect(await audioLanguages()).toEqual(['Japanese', 'English'])
    expect(await screen.findByRole('button', { name: /^Profile menu/ })).toBeVisible()
    await waitFor(() => expect(reads).toEqual({ me: 1, preferences: 1 }))
  })
})
