import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// A phone-width pass over the shells: nothing may scroll sideways, and the widest control —
// the eight-cell pairing code — must sit inside the viewport while it is being typed.

const STUB = 'http://localhost:5198'
const PHONE = { width: 375, height: 667 }

test.use({ viewport: PHONE })

async function setStubMode(request: APIRequestContext, mode: 'renewable' | 'rejected') {
  await request.post(`${STUB}/__test/mode`, { data: { mode } })
}

async function navigateUnderServiceWorkerControl(page: Page, path: string) {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  })
  await page.goto(path)
}

async function expectNoSidewaysScroll(page: Page) {
  const root = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
}

test.beforeEach(async ({ request }) => {
  await setStubMode(request, 'renewable')
})

test('the signed-in home fits a phone', async ({ page }) => {
  await navigateUnderServiceWorkerControl(page, '/')

  await expect(page.getByText('Welcome, Dev Admin')).toBeVisible({ timeout: 15_000 })
  await expectNoSidewaysScroll(page)
  // The ambient wash must not overhang a short page into a phantom scroll.
  const root = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }))
  expect(root.scrollHeight).toBeLessThanOrEqual(root.clientHeight)
})

test('sign-in fits a phone', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  await expectNoSidewaysScroll(page)
})

test('the pairing code fits a phone', async ({ page }) => {
  await navigateUnderServiceWorkerControl(page, '/link')
  const cells = page.locator('.codeInputCell')
  await expect(cells).toHaveCount(8, { timeout: 15_000 })

  await expectNoSidewaysScroll(page)
  const last = await cells.last().boundingBox()
  expect(last).not.toBeNull()
  expect(last!.x + last!.width).toBeLessThanOrEqual(PHONE.width)
})
