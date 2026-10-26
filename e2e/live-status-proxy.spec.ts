import { expect, test } from '@playwright/test'
import type { LibraryFieldsFragment } from '../src/graphql/generated/graphql'
import { meFixture, profileFixture } from '../src/test/meFixture'
import { APP_PORT, STUB_URL } from './ports'

// The one spec whose socket leaves the browser: it crosses the Vite dev proxy to the stub, which
// page.routeWebSocket can never prove.
test.use({ serviceWorkers: 'block' })

const movie: LibraryFieldsFragment = {
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

interface SocketReport {
  upgrades: { host: string | null; origin: string | null; cookie: string | null }[]
  live: string[]
}

test('the dev proxy carries the GraphQL socket and its cookie to the server', async ({
  page,
  context,
  request,
}) => {
  const me = meFixture({
    scope: 'profile',
    profiles: [profileFixture({ selected: true })],
    serverAdmin: true,
  })
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName: string }
    if (operationName === 'Me') return route.fulfill({ json: { data: { me } } })
    if (operationName === 'AdminLibraries' || operationName === 'Libraries')
      return route.fulfill({ json: { data: { libraries: [movie] } } })
    return route.continue()
  })
  await context.addCookies([
    { name: 'proxy-check', value: 'carried', url: `http://localhost:${APP_PORT}` },
  ])
  const socketReport = async () =>
    (await (await request.get(`${STUB_URL}/__test/socket`)).json()) as SocketReport
  const earlierUpgrades = (await socketReport()).upgrades.length

  await page.goto('/settings/server/libraries')
  const status = page
    .getByRole('article', { name: 'Movies settings' })
    .locator('[data-library-status]')
  await expect(status).toHaveText('HEALTHY')
  await expect.poll(async () => (await socketReport()).live).toContain('LibraryStatusChanged')

  const upgrade = (await socketReport()).upgrades[earlierUpgrades]
  expect(upgrade.cookie).toContain('proxy-check=carried')
  expect(upgrade.host).toBe(`localhost:${APP_PORT}`)
  expect(upgrade.origin).toBe(`http://localhost:${APP_PORT}`)

  await request.post(`${STUB_URL}/__test/socket/publish`, {
    data: {
      operationName: 'LibraryStatusChanged',
      payload: { data: { libraryStatusChanged: { ...movie, status: 'SCANNING' } } },
    },
  })
  await expect(status).toHaveText('SCANNING')
})
