import { expect, test, type Page } from '@playwright/test'

// One keyboard focus ring, set in the theme: 2px sky, 2px out, on Mantine's controls and ours.
const RING = { outline: '2px solid rgb(92, 192, 232)', offset: '2px' }

async function focusByKeyboard(page: Page, name: RegExp) {
  await page.getByRole('button', { name }).focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
}

async function ringOnActiveElement(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement
    const style = getComputedStyle(active)
    return {
      name: active.textContent?.trim(),
      outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
      offset: style.outlineOffset,
    }
  })
}

test('keyboard focus draws the theme ring on the sign-in button', async ({ page }) => {
  await page.goto('/login')
  await focusByKeyboard(page, /sign in/i)
  expect(await ringOnActiveElement(page)).toEqual({ name: 'Sign in', ...RING })
})
