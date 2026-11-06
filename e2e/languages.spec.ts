import { expect, test, type Page } from '@playwright/test'
import type {
  LanguageSettingsQuery,
  SetLanguageOverrideInput,
  SetLanguagePreferencesInput,
} from '../src/graphql/generated/graphql'
import { openMovie } from './movieDetail'
import { STUB_URL } from './ports'

test.use({ serviceWorkers: 'block' })

// Records each override the page sets and answers it with the movie's audio set to that language.
async function recordOverrides(page: Page): Promise<SetLanguageOverrideInput[]> {
  const inputs: SetLanguageOverrideInput[] = []
  await page.route('**/graphql', async (route) => {
    const { operationName, variables } = route.request().postDataJSON() as {
      operationName?: string
      variables: { input: SetLanguageOverrideInput }
    }
    if (operationName !== 'SetLanguageOverride') return route.fallback()
    inputs.push(variables.input)
    return route.fulfill({
      json: {
        data: {
          setLanguageOverride: {
            item: {
              __typename: 'Movie',
              id: 'm1',
              selectedProfileState: {
                __typename: 'SelectedProfileState',
                languagePreference: {
                  __typename: 'LanguagePreference',
                  audioLanguages: [variables.input.audioLanguage, 'EN'],
                  subtitleLanguage: null,
                  subtitleMode: 'FORCED',
                  audioSource: 'TITLE',
                  subtitleSource: 'PROFILE',
                },
              },
            },
            userErrors: [],
          },
        },
      },
    })
  })
  return inputs
}

test('the language tabs sit on the rule above the title and open their picker below it', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openMovie(page, request)
  // After openMovie: its route continues every other operation to the stub, past older routes.
  const inputs = await recordOverrides(page)

  const audio = page.getByRole('button', { name: 'Default audio' })
  await expect(audio).toHaveAccessibleDescription('English · from Profile')
  const tab = (await audio.boundingBox())!
  const panel = (await page.getByTestId('detail-panel').boundingBox())!
  const title = (await page.getByRole('heading', { level: 1, name: 'Everlight' }).boundingBox())!
  expect(Math.abs(tab.y + tab.height - panel.y)).toBeLessThanOrEqual(1)
  expect(tab.y + tab.height).toBeLessThanOrEqual(title.y)

  await audio.click()
  const menu = page.getByRole('menu', { name: 'Default audio' })
  const opened = (await menu.boundingBox())!
  expect(opened.y).toBeGreaterThan(tab.y + tab.height)
  expect(opened.y + opened.height).toBeLessThanOrEqual(900)
  await menu.getByRole('menuitemradio', { name: 'Japanese' }).click()

  await expect(audio).toHaveAccessibleDescription('Japanese · set here')
  expect(inputs).toEqual([{ itemId: 'm1', audioLanguage: 'JA' }])
})

test('the picker names the languages that the browser has no name for', async ({
  page,
  request,
}) => {
  await openMovie(page, request)

  await page.getByRole('button', { name: 'Default audio' }).click()

  const menu = page.getByRole('menu', { name: 'Default audio' })
  await expect(menu.getByRole('menuitemradio', { name: 'Afar', exact: true })).toBeAttached()
  await expect(menu.getByRole('menuitemradio', { name: 'Zhuang', exact: true })).toBeAttached()
  await expect(menu.getByRole('menuitemradio', { name: 'aa', exact: true })).toHaveCount(0)
})

test('the language tabs fit a phone without scrolling the page sideways', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await openMovie(page, request)

  for (const name of ['Default audio', 'Subtitles']) {
    const tab = (await page.getByRole('button', { name }).boundingBox())!
    expect(tab.x).toBeGreaterThanOrEqual(0)
    expect(tab.x + tab.width).toBeLessThanOrEqual(375)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})

test('a viewer adds an audio language from the visible list on the Languages screen', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  let saved: LanguageSettingsQuery['me']['languagePreferences'] = {
    __typename: 'ProfileLanguagePreferences',
    audioLanguages: ['EN'],
    subtitleLanguage: null,
    subtitleMode: 'FORCED',
  }
  await page.route('**/graphql', async (route) => {
    const { operationName, variables } = route.request().postDataJSON() as {
      operationName?: string
      variables: { input: SetLanguagePreferencesInput }
    }
    if (operationName === 'LanguageSettings') {
      return route.fulfill({
        json: { data: { me: { __typename: 'Me', languagePreferences: saved } } },
      })
    }
    if (operationName !== 'SetLanguagePreferences') return route.fallback()
    saved = {
      __typename: 'ProfileLanguagePreferences',
      ...variables.input,
      subtitleLanguage: variables.input.subtitleLanguage ?? null,
    }
    return route.fulfill({
      json: { data: { setLanguagePreferences: { languagePreferences: saved, userErrors: [] } } },
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: /^Profile menu/ }).click()
  await page.getByRole('button', { name: 'Languages' }).click()
  await page.getByRole('combobox', { name: 'Add an audio language' }).fill('Fren')
  await page.getByRole('option', { name: 'French', exact: true }).click()

  const languages = page.getByRole('list', { name: 'Audio languages' }).getByRole('listitem')
  await expect(languages).toHaveText([/English/, /French/])
})
