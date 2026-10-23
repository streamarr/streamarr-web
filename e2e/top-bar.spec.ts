import { expect, test, type Locator, type Page } from '@playwright/test'
import { STUB_URL } from './ports'

async function navigateUnderServiceWorkerControl(page: Page) {
  await page.goto('/')
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      message: 'service worker never took control',
    })
    .toBe(true)
  await page.goto('/')
}

test.beforeEach(async ({ request }) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
})

// A `font` shorthand declared after `font-size` resets it, so the pill silently inherited its size.
test('the primary nav pill renders at its declared size', async ({ page }) => {
  await navigateUnderServiceWorkerControl(page)

  const home = page.getByRole('navigation', { name: 'Primary' }).getByText('Home', { exact: true })
  await expect(home).toHaveCSS('font-size', '15px')
})

test('the profile menu notch points at the centre of the profile chip', async ({ page }) => {
  await navigateUnderServiceWorkerControl(page)

  const chip = page.getByRole('button', { name: /^Profile menu/ })
  await chip.click()

  expect(await centreX(page.getByTestId('profile-menu-notch'))).toBeCloseTo(await centreX(chip), 0)
})

async function centreX(element: Locator): Promise<number> {
  const box = await element.boundingBox()
  expect(box, String(element)).not.toBeNull()
  const { x, width } = box as { x: number; width: number }
  return x + width / 2
}
