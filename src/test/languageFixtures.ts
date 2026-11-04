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
 * Serves the language tabs of every title with `preference`, the series of a season, which the
 * detail fixtures call `series-1`, with `seriesPreference`, and the Profile's own with `profile`. Each override the page sets is kept in
 * `inputs`, and answered with `answer` when given, else with the title unchanged.
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
              movie: { __typename: 'Movie', id: String(id), languagePreference: preference },
            }),
            ...(series && {
              series: { __typename: 'Series', id: String(id), languagePreference: preference },
            }),
            ...(season && {
              season: {
                __typename: 'Season',
                id: String(id),
                languagePreference: preference,
                series: {
                  __typename: 'Series',
                  id: 'series-1',
                  languagePreference: seriesPreference,
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
