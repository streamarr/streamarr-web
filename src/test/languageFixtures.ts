import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import type {
  LanguagePreferenceFieldsFragment,
  LanguageTabsQuery,
  LanguageTabsQueryVariables,
  ProfileLanguagePreferencesFieldsFragment,
  SetLanguageOverrideInput,
  SetLanguageOverrideMutation,
  SetLanguageOverrideMutationVariables,
} from '../graphql/generated/graphql'
import { server } from './server'

export function languagePreferenceFixture(
  overrides: Partial<LanguagePreferenceFieldsFragment> = {},
): LanguagePreferenceFieldsFragment {
  return {
    __typename: 'LanguagePreference',
    audioLanguages: ['EN'],
    subtitleLanguage: null,
    subtitleMode: 'FORCED',
    audioSource: 'PROFILE',
    subtitleSource: 'PROFILE',
    ...overrides,
  }
}

/** A title's state for the selected Profile, as the language queries select it. */
export function selectedProfileLanguages(languagePreference: LanguagePreferenceFieldsFragment) {
  return { __typename: 'SelectedProfileState' as const, languagePreference }
}

export function profileLanguagesFixture(
  overrides: Partial<ProfileLanguagePreferencesFieldsFragment> = {},
): ProfileLanguagePreferencesFieldsFragment {
  return {
    __typename: 'ProfileLanguagePreferences',
    audioLanguages: ['EN'],
    subtitleLanguage: null,
    subtitleMode: 'FORCED',
    ...overrides,
  }
}

type OverrideAnswer = SetLanguageOverrideMutation['setLanguageOverride']

/**
 * The server's answer to an override: the title with the preference that results from it.
 */
export function titleBecomes(
  title: { __typename: 'Movie' | 'Series' | 'Season'; id: string },
  preference: LanguagePreferenceFieldsFragment,
): () => OverrideAnswer {
  return () => ({
    item: { ...title, selectedProfileState: selectedProfileLanguages(preference) },
    userErrors: [],
  })
}

/**
 * Serves the language tabs of every title with `preference`, the series of a season, which the
 * detail fixtures call `series-1`, with `seriesPreference`, and the Profile's own with `profile`.
 * Each override the page sets is kept in `inputs`, and answered with `answer` when given, else
 * without the title, which the tabs show as not saved.
 */
export function serveLanguageTabs({
  preference = languagePreferenceFixture(),
  seriesPreference = languagePreferenceFixture(),
  profile = profileLanguagesFixture(),
  answer,
}: {
  preference?: LanguagePreferenceFieldsFragment
  seriesPreference?: LanguagePreferenceFieldsFragment
  profile?: ProfileLanguagePreferencesFieldsFragment
  answer?: (input: SetLanguageOverrideInput) => OverrideAnswer
} = {}) {
  const state = { inputs: [] as SetLanguageOverrideInput[], reads: 0 }
  server.use(
    graphql.query<LanguageTabsQuery, LanguageTabsQueryVariables>(
      'LanguageTabs',
      ({ variables: { id, movie, series, season } }) => {
        state.reads++
        return HttpResponse.json({
          data: {
            ...(movie && {
              movie: {
                __typename: 'Movie',
                id: String(id),
                selectedProfileState: selectedProfileLanguages(preference),
              },
            }),
            ...(series && {
              series: {
                __typename: 'Series',
                id: String(id),
                selectedProfileState: selectedProfileLanguages(preference),
              },
            }),
            ...(season && {
              season: {
                __typename: 'Season',
                id: String(id),
                selectedProfileState: selectedProfileLanguages(preference),
                series: {
                  __typename: 'Series',
                  id: 'series-1',
                  selectedProfileState: selectedProfileLanguages(seriesPreference),
                },
              },
            }),
            me: { __typename: 'Me', languagePreferences: profile },
          },
        })
      },
    ),
    graphql.mutation<SetLanguageOverrideMutation, SetLanguageOverrideMutationVariables>(
      'SetLanguageOverride',
      ({ variables: { input } }) => {
        state.inputs.push(input)
        return HttpResponse.json({
          data: { setLanguageOverride: answer?.(input) ?? { item: null, userErrors: [] } },
        })
      },
    ),
  )
  return state
}

/**
 * Picks a row of the open language picker by its text. A role query would name each of its nearly
 * two hundred rows, which is slow enough to time a test out on a busy machine.
 */
export async function pickMenuRow(user: UserEvent, row: string) {
  await user.click(within(screen.getByRole('menu')).getByText(row, { exact: true }))
}
