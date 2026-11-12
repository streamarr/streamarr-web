import { expect, test, type Page } from '@playwright/test'
import type {
  ChangeInvitationLifetimeInput,
  ChangeShareCodeLifetimeInput,
  ChangeShareCodeLimitInput,
  InvitationLifetimeSettingFieldsFragment,
  ShareCodeLifetimeSettingFieldsFragment,
  ShareCodeLimitSettingFieldsFragment,
} from '../src/graphql/generated/graphql'
import { meFixture, profileFixture } from '../src/test/meFixture'
import { routeGraphqlSocket } from './graphqlSocket'

test.use({ serviceWorkers: 'block' })

const PAGE = '/settings/server/sharing'
const SETTINGS_ID = '5c0f1e2d-3b4a-4968-8776-a5b4c3d2e1f0'

async function fixture(page: Page) {
  const state = {
    me: meFixture({
      scope: 'profile',
      profiles: [profileFixture({ selected: true })],
      serverAdmin: true,
    }),
    limit: {
      __typename: 'ShareCodeLimitSetting',
      id: SETTINGS_ID,
      codes: 10,
      minimumCodes: 1,
      maximumCodes: 100,
    } as ShareCodeLimitSettingFieldsFragment,
    shareCodeLifetime: {
      __typename: 'ShareCodeLifetimeSetting',
      id: SETTINGS_ID,
      hours: 168,
      minimumHours: 1,
      maximumHours: 720,
    } as ShareCodeLifetimeSettingFieldsFragment,
    invitationLifetime: {
      __typename: 'InvitationLifetimeSetting',
      id: SETTINGS_ID,
      hours: 168,
      minimumHours: 1,
      maximumHours: 720,
    } as InvitationLifetimeSettingFieldsFragment,
    socket: await routeGraphqlSocket(page),
  }
  await page.route('**/graphql', async (route) => {
    const { operationName, variables } = route.request().postDataJSON() as {
      operationName: string
      variables: Record<string, unknown>
    }
    const reply = (data: unknown) => route.fulfill({ json: { data } })
    if (operationName === 'Me') return reply({ me: state.me })
    if (operationName === 'Libraries' || operationName === 'AdminLibraries')
      return reply({ libraries: [] })
    if (operationName === 'UnreadNotificationCount') return reply({ unreadNotificationCount: 0 })
    if (operationName === 'ShareOffers')
      return reply({ householdShares: { __typename: 'ProfileShareConnection', edges: [] } })
    if (operationName === 'ShareCodeLimitSetting')
      return reply({ shareCodeLimitSetting: state.limit })
    if (operationName === 'ChangeShareCodeLimit') {
      const { codes } = variables.input as ChangeShareCodeLimitInput
      state.limit = { ...state.limit, codes }
      return reply({ changeShareCodeLimit: { shareCodeLimitSetting: state.limit, userErrors: [] } })
    }
    if (operationName === 'ShareCodeLifetimeSetting')
      return reply({ shareCodeLifetimeSetting: state.shareCodeLifetime })
    if (operationName === 'ChangeShareCodeLifetime') {
      const { hours } = variables.input as ChangeShareCodeLifetimeInput
      state.shareCodeLifetime = { ...state.shareCodeLifetime, hours }
      return reply({
        changeShareCodeLifetime: {
          shareCodeLifetimeSetting: state.shareCodeLifetime,
          userErrors: [],
        },
      })
    }
    if (operationName === 'InvitationLifetimeSetting')
      return reply({ invitationLifetimeSetting: state.invitationLifetime })
    if (operationName === 'ChangeInvitationLifetime') {
      const { hours } = variables.input as ChangeInvitationLifetimeInput
      state.invitationLifetime = { ...state.invitationLifetime, hours }
      return reply({
        changeInvitationLifetime: {
          invitationLifetimeSetting: state.invitationLifetime,
          userErrors: [],
        },
      })
    }
    return route.continue()
  })
  return state
}

test('a ServerAdmin counts how long a share code lasts in hours, and a reload shows it', async ({
  page,
}) => {
  const state = await fixture(page)
  await page.goto('/settings/server/libraries')
  const rail = page.getByRole('navigation', { name: 'Server settings' })
  await rail.getByRole('link', { name: 'Sharing and invitations' }).click()
  await expect(page).toHaveURL(PAGE)

  const lasts = page.getByRole('textbox', { name: 'A share code lasts' })
  const unit = page.getByRole('combobox', { name: 'A share code lasts, unit' })
  await expect(lasts).toHaveValue('7')
  await expect(unit).toHaveValue('days')
  await unit.click()
  await page.getByRole('option', { name: 'hours', exact: true }).click()
  await lasts.fill('36')
  await page.getByRole('button', { name: 'Save how long a share code lasts' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toHaveText(
    'Saved. A share code lasts 36 hours.',
  )
  await expect(lasts).toBeFocused()
  expect(state.shareCodeLifetime.hours).toBe(36)

  await page.reload()
  await expect(lasts).toHaveValue('36')
  await expect(unit).toHaveValue('hours')
})

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`the section fits a window ${width} pixels wide without scrolling sideways`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height })
    await fixture(page)
    await page.goto(PAGE)
    const lasts = page.getByRole('textbox', { name: 'A share code lasts' })
    const unit = page.getByRole('combobox', { name: 'A share code lasts, unit' })
    await expect(lasts).toHaveValue('7')

    // The unit follows the number on its line.
    const number = (await lasts.boundingBox())!
    const choice = (await unit.boundingBox())!
    expect(Math.abs(choice.y - number.y)).toBeLessThanOrEqual(1)
    expect(choice.x).toBeGreaterThan(number.x + number.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.screenshot({ path: testInfo.outputPath(`sharing-${width}.png`), fullPage: true })
  })
}
