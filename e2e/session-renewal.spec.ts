import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// End-to-end proof that the dev-served app keeps sessions alive: the service worker must take
// control of the page (a scope regression leaves it activated but controlling nothing), renew
// an expired access token transparently, and hand a dead session to the login page instead of
// wedging on an error alert.

const STUB = 'http://localhost:5198'

async function setStubMode(request: APIRequestContext, mode: 'renewable' | 'rejected') {
  await request.post(`${STUB}/__test/mode`, { data: { mode } })
}

async function navigateUnderServiceWorkerControl(page: Page) {
  // The first navigation registers the worker; only after clients.claim() does it control the
  // page. The guard may bounce that uncontrolled first load to /login (its probe can race the
  // claim), so navigate back to the root once control exists — every fetch from here on flows
  // through a controlled document.
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  })
  await page.goto('/')
}

test.beforeEach(async ({ request }) => {
  await setStubMode(request, 'renewable')
})

test('the service worker takes control of the dev-served app', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  })
})

test('an expired session renews and replays into the signed-in shell', async ({ page }) => {
  await navigateUnderServiceWorkerControl(page)

  await expect(page.getByText('Welcome, Dev Admin')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a dead refresh session lands on sign-in instead of wedging', async ({ page, request }) => {
  await setStubMode(request, 'rejected')

  await navigateUnderServiceWorkerControl(page)

  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
})
