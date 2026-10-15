import { expect, test, type Page } from '@playwright/test'
import { RING, ringOnActiveElement } from './focusRing'

async function focusByKeyboard(page: Page, name: RegExp) {
  await page.getByRole('button', { name }).focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
}

test('keyboard focus draws the theme ring on the sign-in button', async ({ page }) => {
  await page.goto('/login')
  await focusByKeyboard(page, /sign in/i)
  expect(await ringOnActiveElement(page)).toEqual({ name: 'Sign in', ...RING })
})
