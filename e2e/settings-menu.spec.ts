import { expect, test } from '@playwright/test'
import { STUB_URL } from './ports'

// The settings menu is at its narrowest beside the page between 761 and 1200 pixels.
test.use({ serviceWorkers: 'block', viewport: { width: 1024, height: 768 } })

test('the Household settings menu shows its title on one line where the menu is narrowest', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName?: string }
    if (operationName !== 'ShareOffers') return route.fallback()
    return route.fulfill({
      json: {
        data: { householdShares: { __typename: 'ProfileShareConnection', edges: [] } },
      },
    })
  })

  await page.goto('/settings/household/offers')
  const title = page
    .getByRole('navigation', { name: 'Household settings' })
    .getByText('Household settings', { exact: true })
  await expect(title).toBeVisible()

  const lineCount = await title.evaluate((element) => {
    const text = document.createRange()
    text.selectNodeContents(element)
    return text.getClientRects().length
  })
  expect(lineCount).toBe(1)
})
