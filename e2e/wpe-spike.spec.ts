import { test } from '@playwright/test'

test('SPIKE platform facts', async ({ page }) => {
  await page.route('**/spike', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>s</title>' }),
  )
  await page.goto('/spike')
  const facts = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    vendor: navigator.vendor,
    appVersion: navigator.appVersion,
    oscpu: (navigator as unknown as { oscpu?: string }).oscpu ?? null,
  }))
  console.log(`SPIKE-RESULT ${JSON.stringify(facts)}`)
})
