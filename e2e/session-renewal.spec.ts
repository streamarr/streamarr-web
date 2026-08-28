import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { STUB_URL } from './ports'

// Proves the dev-served app keeps sessions alive: the service worker takes control of the page,
// renews an expired access token transparently, and sends a dead session to sign-in.

async function setStubMode(request: APIRequestContext, mode: 'renewable' | 'rejected') {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode } })
}

async function expectServiceWorkerControl(page: Page) {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      message: 'service worker never took control',
    })
    .toBe(true)
}

async function navigateUnderServiceWorkerControl(page: Page) {
  // The guard may bounce the uncontrolled first load to /login (its probe races clients.claim()),
  // so navigate again once the worker controls the page.
  await page.goto('/')
  await expectServiceWorkerControl(page)
  await page.goto('/')
}

test.beforeEach(async ({ request }) => {
  await setStubMode(request, 'renewable')
})

test('the service worker takes control of the dev-served app', async ({ page }) => {
  await page.goto('/')
  await expectServiceWorkerControl(page)
})

test('an expired session renews and replays into the signed-in shell', async ({ page }) => {
  await navigateUnderServiceWorkerControl(page)

  await expect(page.getByRole('heading', { name: 'Welcome, Dev Admin' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a dead refresh session lands on sign-in instead of wedging', async ({ page, request }) => {
  await setStubMode(request, 'rejected')

  await navigateUnderServiceWorkerControl(page)

  await expect(page).toHaveURL(/\/login/)
})
