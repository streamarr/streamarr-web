import { expect, test, type Page } from '@playwright/test'
import type {
  AddLibraryInput,
  ManagedLibraryFieldsFragment,
} from '../src/graphql/generated/graphql'
import { meFixture, profileFixture } from '../src/test/meFixture'

test.use({ serviceWorkers: 'block' })

const SETTINGS = '/settings/server/libraries'
const movie: ManagedLibraryFieldsFragment = {
  __typename: 'Library',
  id: 'movies',
  name: 'Movies',
  type: 'MOVIE',
  backend: 'LOCAL',
  filepathUri: 'file:///media/movies/',
  status: 'HEALTHY',
  scanStartedOn: '2026-09-21T13:00:00Z',
  scanCompletedOn: '2026-09-21T13:01:00Z',
}
const shows: ManagedLibraryFieldsFragment = {
  ...movie,
  id: 'shows',
  name: 'TV shows',
  type: 'SERIES',
  filepathUri: 'file:///media/tv/',
}

async function fixture(page: Page, libraries = [movie, shows]) {
  const state = {
    libraries,
    me: meFixture({
      scope: 'profile',
      profiles: [profileFixture({ selected: true })],
      serverAdmin: true,
    }),
    calls: [] as { operationName: string; variables: Record<string, unknown> }[],
    inventoryFails: false,
    removalFails: false,
  }
  await page.route('**/graphql', async (route) => {
    const { operationName, variables } = route.request().postDataJSON() as {
      operationName: string
      variables: Record<string, unknown>
    }
    state.calls.push({ operationName, variables })
    const reply = (data: unknown) => route.fulfill({ json: { data } })
    if (operationName === 'Me') return reply({ me: state.me })
    if (operationName === 'Libraries') return reply({ libraries: state.libraries })
    if (operationName === 'AdminLibraries') {
      if (state.inventoryFails) return route.fulfill({ json: { errors: [{ message: 'offline' }] } })
      return reply({ libraries: state.libraries })
    }
    if (operationName === 'Home')
      return reply({
        continueWatching: [],
        libraries: state.libraries.map((library) => ({ ...library, items: { edges: [] } })),
      })
    if (operationName === 'AddLibrary') {
      const input = variables.input as AddLibraryInput
      if (input.filepath === '/missing')
        return reply({
          addLibrary: {
            library: null,
            userErrors: [
              {
                __typename: 'LibraryPathNotFoundError',
                message: 'Folder not found on the server.',
                inputPath: ['filepath'],
              },
            ],
          },
        })
      const library = {
        ...movie,
        id: 'new-library',
        name: input.name,
        type: input.type,
        filepathUri: input.filepath,
        status: 'SCANNING' as const,
        scanCompletedOn: null,
      }
      state.libraries.push(library)
      return reply({ addLibrary: { library, userErrors: [] } })
    }
    if (operationName === 'ScanLibrary' || operationName === 'RefreshLibrary') {
      state.libraries = state.libraries.map((library) =>
        library.id === variables.id
          ? { ...library, status: operationName === 'ScanLibrary' ? 'SCANNING' : 'REFRESHING' }
          : library,
      )
      return reply(
        operationName === 'ScanLibrary' ? { scanLibrary: true } : { refreshLibrary: true },
      )
    }
    if (operationName === 'RemoveLibrary') {
      if (state.removalFails) return reply({ removeLibrary: false })
      state.libraries = state.libraries.filter((library) => library.id !== variables.id)
      return reply({ removeLibrary: true })
    }
    return route.continue()
  })
  return state
}

test('first-run creation validates the server path and stays in settings', async ({ page }) => {
  const state = await fixture(page, [])
  await page.goto('/')
  await page.getByRole('link', { name: 'Add library', exact: true }).click()
  await expect(page).toHaveURL(`${SETTINGS}/new`)
  await page.getByRole('radio', { name: 'TV shows' }).check()
  await page.getByRole('textbox', { name: 'Library name' }).fill('Family TV')
  await page.getByRole('textbox', { name: 'Server folder' }).fill('/missing')
  await page.getByRole('button', { name: 'Add library', exact: true }).click()
  await expect(page.getByText('Folder not found on the server.')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Server folder' })).toBeFocused()
  await page.getByRole('textbox', { name: 'Server folder' }).fill('/media/family')
  await page.getByRole('button', { name: 'Add library', exact: true }).click()
  await expect(page).toHaveURL(`${SETTINGS}?library=new-library`)
  const detail = page.getByRole('article', { name: 'Family TV settings' })
  await expect(detail).toContainText('SCANNING')
  await expect(detail.getByRole('button', { name: 'Scan library' })).toBeDisabled()
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Family TV' }),
  ).toBeVisible()
  state.libraries = state.libraries.map((library) => ({ ...library, status: 'HEALTHY' }))
  await page.reload()
  await expect(detail).toContainText('HEALTHY')
  await expect(detail.getByRole('button', { name: 'Scan library' })).toBeEnabled()
})

test('settings reuse the app chrome and preserve selection across reload and back', async ({
  page,
}) => {
  await fixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Profile menu/ }).click()
  await page.getByRole('button', { name: 'Server settings', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Libraries to manage' })
    .getByRole('button', { name: /TV shows/ })
    .click()
  await page.reload()
  await expect(page.getByRole('article', { name: 'TV shows settings' })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Libraries to manage' })
    .getByRole('button', { name: /Movies/ })
    .click()
  await page.goBack()
  await expect(page.getByRole('article', { name: 'TV shows settings' })).toBeVisible()
  await expect(page.getByRole('banner')).toHaveCount(1)
})

test('settings fetch again only on reload, not timers, focus, or visibility changes', async ({
  page,
}) => {
  const state = await fixture(page)
  await page.clock.install()
  await page.goto(SETTINGS)
  const detail = page.getByRole('article', { name: 'Movies settings' })
  await expect(detail).toContainText('HEALTHY')
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Movies' }),
  ).toBeVisible()
  const reads = () =>
    state.calls.filter((call) => ['Me', 'AdminLibraries', 'Libraries'].includes(call.operationName))
      .length
  const initialReads = reads()
  state.libraries = [{ ...movie, status: 'UNHEALTHY' }]
  await page.clock.fastForward(65_000)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.runFor(1_000)
  await expect(detail.locator('[data-library-status]')).toHaveText('HEALTHY')
  expect(reads()).toBe(initialReads)

  await page.reload()
  await expect(detail.locator('[data-library-status]')).toHaveText('UNHEALTHY')
  expect(reads()).toBeGreaterThan(initialReads)
})

test('refresh expands in place with aligned controls and returns focus', async ({
  page,
}, testInfo) => {
  const state = await fixture(page)
  await page.goto(SETTINGS)
  const trigger = page.getByRole('button', { name: 'Refresh metadata', exact: true })
  await trigger.click()
  const editor = page.getByRole('region', { name: 'Refresh metadata for Movies' })
  await expect(editor).toBeVisible()
  await expect
    .poll(async () =>
      editor
        .getByRole('combobox', { name: 'Images' })
        .evaluate((node) => node.getBoundingClientRect().height),
    )
    .toBe(40)
  const heights = await editor
    .locator('input:not([type=hidden]), button')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getBoundingClientRect().height > 0)
        .map((node) => node.getBoundingClientRect().height),
    )
  expect(heights.every((height) => height === 40)).toBe(true)
  const metadata = await page.locator('dl').boundingBox()
  expect((await editor.boundingBox())!.y).toBeGreaterThan(metadata!.y)
  // Wait for the height transition before comparing the final document flow.
  await expect
    .poll(async () => {
      const inline = await editor.boundingBox()
      const actions = await page.getByRole('heading', { name: 'Library actions' }).boundingBox()
      return inline!.y + inline!.height <= actions!.y + 1
    })
    .toBe(true)
  await page.screenshot({ path: testInfo.outputPath('admin-refresh-desktop.png') })
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await editor.getByRole('combobox', { name: 'Images' }).click()
  await page.getByRole('option', { name: 'Update changed images' }).click()
  const inventoryRequests = state.calls.filter(
    (call) => call.operationName === 'AdminLibraries',
  ).length
  await editor.getByRole('button', { name: 'Refresh metadata' }).click()
  await expect(page.getByRole('article')).toContainText(
    'Metadata refresh requested for Movies. Refresh the page to see the latest status.',
  )
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('article').locator('[data-library-status]')).toHaveText('HEALTHY')
  expect(state.calls.filter((call) => call.operationName === 'AdminLibraries')).toHaveLength(
    inventoryRequests,
  )
  expect(state.calls.find((call) => call.operationName === 'RefreshLibrary')?.variables).toEqual({
    id: 'movies',
    imageRefreshMode: 'REFRESH_IF_CHANGED',
  })
  await page.reload()
  await expect(page.getByRole('article').locator('[data-library-status]')).toHaveText('REFRESHING')
})

test('removal requires confirmation, keeps errors in the dialog, and updates Home', async ({
  page,
}) => {
  const state = await fixture(page, [movie])
  await page.goto('/') // Seed Home's cache before removal.
  await page.getByRole('button', { name: /Profile menu/ }).click()
  await page.getByRole('button', { name: 'Server settings', exact: true }).click()
  await page.getByRole('button', { name: 'Remove library', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove Movies?' })
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await expect(dialog).toContainText('Your files stay on disk.')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Remove library' })).toBeFocused()
  expect(state.calls.filter((call) => call.operationName === 'RemoveLibrary')).toHaveLength(0)
  state.removalFails = true
  await page.getByRole('button', { name: 'Remove library', exact: true }).click()
  await dialog.getByRole('button', { name: 'Remove library', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  state.removalFails = false
  await dialog.getByRole('button', { name: 'Remove library', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add your first library' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Home' })
    .click()
  await expect(page.getByRole('link', { name: 'Add library', exact: true })).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Movies' }),
  ).toHaveCount(0)
})

test('ineligible accounts cannot enter via direct URLs or the menu', async ({ page }) => {
  const state = await fixture(page)
  for (const eligibility of [
    { serverAdmin: false, deviceBound: false },
    { serverAdmin: true, deviceBound: true },
  ]) {
    Object.assign(state.me, eligibility)
    await page.goto(`${SETTINGS}/new`)
    await expect(page.getByRole('alert')).toContainText(
      'Server settings are available to server admins',
    )
    await expect(page.getByRole('textbox', { name: 'Server folder' })).toHaveCount(0)
    await page.getByRole('button', { name: /Profile menu/ }).click()
    await expect(page.getByRole('button', { name: 'Server settings', exact: true })).toHaveCount(0)
  }
  expect(state.calls.filter((call) => call.operationName === 'AdminLibraries')).toHaveLength(0)
})

test('Library workspace and creation share a width and fit phone and desktop layouts', async ({
  page,
}, testInfo) => {
  await fixture(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(SETTINGS)
    await expect(page.getByRole('article')).toBeVisible()
    const workspace = await page.locator('[class*="_splitPanel_"]').boundingBox()
    await page.getByRole('button', { name: 'Refresh metadata', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Refresh metadata for Movies' })).toBeVisible()
    expect(
      await page.locator('main').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`admin-workspace-${width}.png`),
      fullPage: true,
    })
    await page.getByRole('link', { name: 'Add library', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Server folder' })).toBeVisible()
    const form = await page.locator('[class*="_formPanel_"]').boundingBox()
    expect(form!.width).toBeCloseTo(workspace!.width, 0)
    expect(
      await page.locator('main').evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`admin-create-${width}.png`),
      fullPage: true,
    })
  }
})
