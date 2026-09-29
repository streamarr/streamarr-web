import { expect, test, type Page } from '@playwright/test'
import { STUB_URL } from './ports'

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

test.describe('a media title that does not exist', () => {
  // A worker-sent request would bypass page.route.
  test.use({ serviceWorkers: 'block' })

  test('keyboard focus draws the theme ring on Back', async ({ page, request }) => {
    await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
    await request.post(`${STUB_URL}/api/auth/refresh`)
    await page.route('**/graphql', async (route) => {
      const { operationName } = route.request().postDataJSON() as { operationName?: string }
      if (operationName !== 'MovieDetail') return route.continue()
      return route.fulfill({ json: { data: { movie: null } } })
    })
    await page.goto('/movie/m1')
    await expect(page.getByRole('alert')).toHaveText("This movie doesn't exist or was removed.")

    await focusByKeyboard(page, /^back$/i)

    expect(await ringOnActiveElement(page)).toEqual({ name: 'Back', ...RING })
  })
})
