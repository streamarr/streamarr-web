import { expect, test, type Locator, type Page } from '@playwright/test'
import { STUB_URL } from './ports'

// Layout snaps fractional offsets, so computed geometry lands a few thousandths off its target.
const SUBPIXEL = 0.01

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

test('the profile menu notch stands clear of the open profile chip and its ring', async ({
  page,
}) => {
  await navigateUnderServiceWorkerControl(page)

  const chip = page.getByRole('button', { name: /^Profile menu/ })
  await chip.click()

  const ringBottom = (await box(chip)).bottom + (await ringWidth(chip))
  expect(
    (await box(page.getByTestId('profile-menu-notch'))).top - ringBottom,
  ).toBeGreaterThanOrEqual(4 - SUBPIXEL)
})

// Past the menu's corner radius its top border curves away, leaving a gap beside the notch.
test('the profile menu notch meets the menu where its top border runs straight', async ({
  page,
}) => {
  await navigateUnderServiceWorkerControl(page)

  const chip = page.getByRole('button', { name: /^Profile menu/ })
  await chip.click()

  const notch = await box(page.getByTestId('profile-menu-notch'))
  const menu = page.getByTestId('profile-menu')
  const radius = parseFloat(
    await menu.evaluate((element) => getComputedStyle(element).borderTopRightRadius),
  )
  const { left, right } = await box(menu)
  expect(notch.left).toBeGreaterThanOrEqual(left + radius - SUBPIXEL)
  expect(notch.right).toBeLessThanOrEqual(right - radius + SUBPIXEL)
})

async function box(element: Locator) {
  const bounds = await element.boundingBox()
  expect(bounds, String(element)).not.toBeNull()
  const { x, y, width, height } = bounds as { x: number; y: number; width: number; height: number }
  return { left: x, top: y, right: x + width, bottom: y + height }
}

// The open chip's ring is a spread-only box-shadow: `<color> 0px 0px 0px <spread>`.
async function ringWidth(chip: Locator): Promise<number> {
  const shadow = await chip.evaluate((element) => getComputedStyle(element).boxShadow)
  return parseFloat(shadow.trim().split(/\s+/).at(-1) ?? '0')
}

async function centreX(element: Locator): Promise<number> {
  const { left, right } = await box(element)
  return (left + right) / 2
}
