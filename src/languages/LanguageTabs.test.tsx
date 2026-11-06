import { useApolloClient } from '@apollo/client/react'
import { act, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import type {
  LanguagePreferenceFieldsFragment,
  SetLanguageOverrideInput,
} from '../graphql/generated/graphql'
import { heldAnswer, networkFailure } from '../test/graphqlResponses'
import {
  languagePreferenceFixture,
  pickMenuRow,
  profileLanguagesFixture,
  selectedProfileLanguages,
  serveLanguageTabs,
  titleBecomes,
} from '../test/languageFixtures'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { LanguageTabs, type LanguageTabsItem } from './LanguageTabs'

const MOVIE: LanguageTabsItem = { kind: 'movie', id: 'm1' }
const SERIES: LanguageTabsItem = { kind: 'series', id: 's1' }
const SEASON: LanguageTabsItem = { kind: 'season', id: 'season-2' }

function movieBecomes(preference: LanguagePreferenceFieldsFragment) {
  return titleBecomes({ __typename: 'Movie', id: 'm1' }, preference)
}

async function tab(name: 'Default audio' | 'Subtitles') {
  return screen.findByRole('button', { name })
}

async function pick(user: UserEvent, tabName: 'Default audio' | 'Subtitles', option: string) {
  await user.click(await tab(tabName))
  await pickMenuRow(user, option)
}

function rowNames(): string[] {
  return within(screen.getByRole('menu'))
    .getAllByRole('menuitemradio')
    .map((row) => row.textContent ?? '')
}

function checkedRow(): string | undefined {
  return (
    within(screen.getByRole('menu'))
      .getAllByRole('menuitemradio')
      .find((row) => row.getAttribute('aria-checked') === 'true')?.textContent ?? undefined
  )
}

describe('LanguageTabs', () => {
  it('shouldShowEachValueAndWhereItComesFromWhenTheProfileDecidesThem', async () => {
    serveLanguageTabs()
    renderWithProviders(<LanguageTabs item={MOVIE} />)

    expect(await tab('Default audio')).toHaveAccessibleDescription('English · from Profile')
    expect(await tab('Subtitles')).toHaveAccessibleDescription('Forced only · from Profile')
  })

  it('shouldShowNoTabsWhenTheNextProfilesLanguagesCannotBeRead', async () => {
    serveLanguageTabs()
    let resetStore: (() => Promise<unknown>) | undefined
    function ObservedTabs() {
      const client = useApolloClient()
      useEffect(() => {
        resetStore = () => client.resetStore()
      }, [client])
      return <LanguageTabs item={MOVIE} />
    }
    renderWithProviders(<ObservedTabs />)
    await tab('Default audio')
    server.use(graphql.query('LanguageTabs', () => networkFailure()))

    await act(async () => {
      await resetStore?.().catch(() => undefined)
    })

    expect(await screen.findByText("Couldn't load the languages.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Default audio' })).not.toBeInTheDocument()
  })

  it('shouldSayAValueIsSetHereWhenTheTitlesOwnOverrideDecidesIt', async () => {
    serveLanguageTabs({
      preference: languagePreferenceFixture({
        audioLanguages: ['JA', 'EN'],
        audioSource: 'TITLE',
        subtitleLanguage: 'EN',
        subtitleMode: 'ALWAYS',
        subtitleSource: 'TITLE',
      }),
    })
    renderWithProviders(<LanguageTabs item={MOVIE} />)

    expect(await tab('Default audio')).toHaveAccessibleDescription('Japanese · set here')
    expect(await tab('Subtitles')).toHaveAccessibleDescription('English · set here')
  })

  it('shouldSayEachFilePlaysItsDefaultWhenNoLevelNamesAnAudioLanguage', async () => {
    serveLanguageTabs({
      preference: languagePreferenceFixture({ audioLanguages: [] }),
      profile: profileLanguagesFixture({ audioLanguages: [] }),
    })
    const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

    expect(await tab('Default audio')).toHaveAccessibleDescription('File default · from Profile')
    await user.click(await tab('Default audio'))
    expect(rowNames()[0]).toBe('From Profile · File default')
  })

  it('shouldNameASubtitleModeAndSourceNewerThanThisClientInGeneralWords', async () => {
    serveLanguageTabs({
      preference: languagePreferenceFixture({
        subtitleMode: '%future added value',
        subtitleSource: '%future added value',
      }),
    })
    renderWithProviders(<LanguageTabs item={MOVIE} />)

    expect(await tab('Subtitles')).toHaveAccessibleDescription('Other · from elsewhere')
  })

  it('shouldOfferTheWiderChoiceThenTheProfilesLanguagesThenEveryOtherWhenAudioOpens', async () => {
    serveLanguageTabs({ profile: profileLanguagesFixture({ audioLanguages: ['EN', 'FR'] }) })
    const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

    await user.click(await tab('Default audio'))

    const rows = rowNames()
    expect(rows.slice(0, 3)).toEqual(['From Profile · English', 'English', 'French'])
    expect(rows.filter((row) => row === 'French')).toHaveLength(1)
    expect(rows).toContain('Japanese')
    expect(checkedRow()).toBe('From Profile · English')
  })

  it('shouldSetTheMoviesAudioLanguageAloneWhenTheViewerPicksOne', async () => {
    const state = serveLanguageTabs({
      answer: movieBecomes(
        languagePreferenceFixture({ audioLanguages: ['JA', 'EN'], audioSource: 'TITLE' }),
      ),
    })
    const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

    await pick(user, 'Default audio', 'Japanese')

    await waitFor(() =>
      expect(state.inputs).toEqual<SetLanguageOverrideInput[]>([
        { itemId: 'm1', audioLanguage: 'JA' },
      ]),
    )
    await waitFor(async () =>
      expect(await tab('Default audio')).toHaveAccessibleDescription('Japanese · set here'),
    )
  })

  it('shouldClearOnlyTheAudioWhenTheViewerPicksTheWiderChoice', async () => {
    const state = serveLanguageTabs({
      preference: languagePreferenceFixture({ audioLanguages: ['JA', 'EN'], audioSource: 'TITLE' }),
      answer: movieBecomes(languagePreferenceFixture()),
    })
    const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

    await user.click(await tab('Default audio'))
    expect(checkedRow()).toBe('Japanese')
    await pickMenuRow(user, 'From Profile · English')

    await waitFor(() => expect(state.inputs).toEqual([{ itemId: 'm1', audioLanguage: null }]))
    await waitFor(async () =>
      expect(await tab('Default audio')).toHaveAccessibleDescription('English · from Profile'),
    )
  })

  it('shouldTurnSubtitlesOnInALanguageWhenTheViewerPicksOne', async () => {
    const state = serveLanguageTabs({
      answer: movieBecomes(
        languagePreferenceFixture({
          subtitleLanguage: 'DE',
          subtitleMode: 'ALWAYS',
          subtitleSource: 'TITLE',
        }),
      ),
    })
    const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

    await pick(user, 'Subtitles', 'German')

    await waitFor(() =>
      expect(state.inputs).toEqual([
        { itemId: 'm1', subtitleLanguage: 'DE', subtitleMode: 'ALWAYS' },
      ]),
    )
    await waitFor(async () =>
      expect(await tab('Subtitles')).toHaveAccessibleDescription('German · set here'),
    )
  })

  it.each([
    { option: 'Off', subtitleMode: 'OFF' },
    { option: 'Forced only', subtitleMode: 'FORCED' },
  ] as const)(
    'shouldSetTheSubtitleModeAloneWhenTheViewerPicks$option',
    async ({ option, subtitleMode }) => {
      const state = serveLanguageTabs({
        answer: movieBecomes(languagePreferenceFixture({ subtitleMode, subtitleSource: 'TITLE' })),
      })
      const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

      await pick(user, 'Subtitles', option)

      await waitFor(() => expect(state.inputs).toEqual([{ itemId: 'm1', subtitleMode }]))
      await waitFor(async () =>
        expect(await tab('Subtitles')).toHaveAccessibleDescription(`${option} · set here`),
      )
    },
  )

  it('shouldClearTheSubtitleLanguageAndModeWhenTheViewerPicksTheWiderChoice', async () => {
    const state = serveLanguageTabs({
      preference: languagePreferenceFixture({ subtitleMode: 'OFF', subtitleSource: 'TITLE' }),
      answer: movieBecomes(languagePreferenceFixture()),
    })
    const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

    await user.click(await tab('Subtitles'))
    expect(rowNames().slice(0, 3)).toEqual(['From Profile · Forced only', 'Off', 'Forced only'])
    expect(checkedRow()).toBe('Off')
    await pickMenuRow(user, 'From Profile · Forced only')

    await waitFor(() =>
      expect(state.inputs).toEqual([{ itemId: 'm1', subtitleLanguage: null, subtitleMode: null }]),
    )
    await waitFor(async () =>
      expect(await tab('Subtitles')).toHaveAccessibleDescription('Forced only · from Profile'),
    )
  })

  it('shouldSetTheSeriesOverrideAndOfferTheProfilesChoiceOnASeries', async () => {
    const state = serveLanguageTabs({
      profile: profileLanguagesFixture({ audioLanguages: ['DE'] }),
      answer: titleBecomes(
        { __typename: 'Series', id: 's1' },
        languagePreferenceFixture({ audioLanguages: ['JA', 'DE'], audioSource: 'SERIES' }),
      ),
    })
    const { user } = renderWithProviders(<LanguageTabs item={SERIES} />)

    await user.click(await tab('Default audio'))
    expect(rowNames()[0]).toBe('From Profile · German')
    await pickMenuRow(user, 'Japanese')

    await waitFor(() => expect(state.inputs).toEqual([{ itemId: 's1', audioLanguage: 'JA' }]))
    await waitFor(async () =>
      expect(await tab('Default audio')).toHaveAccessibleDescription('Japanese · set here'),
    )
  })

  it('shouldOfferTheSeriesChoiceAndSayWhereItComesFromOnASeason', async () => {
    const fromSeries = languagePreferenceFixture({ audioLanguages: ['JA'], audioSource: 'SERIES' })
    const state = serveLanguageTabs({
      preference: fromSeries,
      seriesPreference: fromSeries,
      answer: titleBecomes(
        { __typename: 'Season', id: 'season-2' },
        languagePreferenceFixture({ audioLanguages: ['EN', 'JA'], audioSource: 'SEASON' }),
      ),
    })
    const { user } = renderWithProviders(<LanguageTabs item={SEASON} />)

    expect(await tab('Default audio')).toHaveAccessibleDescription('Japanese · from series')
    await user.click(await tab('Default audio'))
    expect(rowNames()[0]).toBe('From series · Japanese')
    expect(checkedRow()).toBe('From series · Japanese')
    await pickMenuRow(user, 'English')

    await waitFor(() => expect(state.inputs).toEqual([{ itemId: 'season-2', audioLanguage: 'EN' }]))
    await waitFor(async () =>
      expect(await tab('Default audio')).toHaveAccessibleDescription('English · set here'),
    )
  })

  it('shouldHoldBothTabsUntilTheServerAnswersAnOverride', async () => {
    serveLanguageTabs()
    const answer = heldAnswer({
      setLanguageOverride: movieBecomes(
        languagePreferenceFixture({ audioLanguages: ['JA', 'EN'], audioSource: 'TITLE' }),
      )(),
    })
    server.use(graphql.mutation('SetLanguageOverride', answer.answer))
    const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

    await pick(user, 'Default audio', 'Japanese')

    expect(await tab('Default audio')).toHaveFocus()
    expect(await tab('Default audio')).toHaveAttribute('aria-disabled', 'true')
    await user.click(await tab('Subtitles'))
    expect(screen.queryByRole('menu')).toBeNull()
    answer.release()
    await waitFor(async () => expect(await tab('Subtitles')).not.toHaveAttribute('aria-disabled'))
    expect(await tab('Default audio')).toHaveAccessibleDescription('Japanese · set here')
  })

  it('shouldShowTheServersWordsWhenItRefusesTheOverride', async () => {
    serveLanguageTabs({
      answer: () => ({
        item: null,
        userErrors: [{ __typename: 'ItemNotFoundError', message: 'No movie has that ID.' }],
      }),
    })
    const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

    await pick(user, 'Default audio', 'Japanese')

    expect(await screen.findByRole('alert')).toHaveTextContent('No movie has that ID.')
    expect(await tab('Default audio')).toHaveAccessibleDescription('English · from Profile')
  })

  it('shouldSayTheChangeWasNotSavedWhenTheRequestFails', async () => {
    serveLanguageTabs()
    server.use(graphql.mutation('SetLanguageOverride', () => networkFailure()))
    const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

    await pick(user, 'Default audio', 'Japanese')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't save the language. Try again.",
    )
  })

  it('shouldOfferRetryWhenTheTabsCannotLoad', async () => {
    const state = serveLanguageTabs()
    server.use(graphql.query('LanguageTabs', () => networkFailure(), { once: true }))
    const { user } = renderWithProviders(<LanguageTabs item={MOVIE} />)

    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await tab('Default audio')).toHaveAccessibleDescription('English · from Profile')
    expect(state.reads).toBe(1)
  })

  it('shouldShowNoTabsWhenNoProfileIsSelected', async () => {
    serveLanguageTabs()
    server.use(
      graphql.query('LanguageTabs', () =>
        HttpResponse.json({
          data: {
            movie: {
              __typename: 'Movie',
              id: 'm1',
              selectedProfileState: selectedProfileLanguages(languagePreferenceFixture()),
            },
            me: { __typename: 'Me', languagePreferences: null },
          },
        }),
      ),
    )
    renderWithProviders(<LanguageTabs item={MOVIE} />)

    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading the languages' })).toBeNull(),
    )
    expect(screen.queryByRole('button', { name: 'Default audio' })).toBeNull()
  })

  it('shouldShowNoTabsWhenTheTitleHasNoSelectedProfileState', async () => {
    serveLanguageTabs()
    server.use(
      graphql.query('LanguageTabs', () =>
        HttpResponse.json({
          data: {
            movie: { __typename: 'Movie', id: 'm1', selectedProfileState: null },
            me: { __typename: 'Me', languagePreferences: profileLanguagesFixture() },
          },
        }),
      ),
    )
    renderWithProviders(
      <>
        <LanguageTabs item={MOVIE} />
        <p>Beside the tabs</p>
      </>,
    )

    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading the languages' })).toBeNull(),
    )
    expect(screen.queryByRole('button', { name: 'Default audio' })).toBeNull()
    expect(screen.getByText('Beside the tabs')).toBeInTheDocument()
  })

  it('shouldShowNoTabsWhenTheSeasonsSeriesHasNoSelectedProfileState', async () => {
    serveLanguageTabs()
    server.use(
      graphql.query('LanguageTabs', () =>
        HttpResponse.json({
          data: {
            season: {
              __typename: 'Season',
              id: 'season-2',
              selectedProfileState: selectedProfileLanguages(languagePreferenceFixture()),
              series: { __typename: 'Series', id: 'series-1', selectedProfileState: null },
            },
            me: { __typename: 'Me', languagePreferences: profileLanguagesFixture() },
          },
        }),
      ),
    )
    renderWithProviders(
      <>
        <LanguageTabs item={SEASON} />
        <p>Beside the tabs</p>
      </>,
    )

    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading the languages' })).toBeNull(),
    )
    expect(screen.queryByRole('button', { name: 'Default audio' })).toBeNull()
    expect(screen.getByText('Beside the tabs')).toBeInTheDocument()
  })
})
