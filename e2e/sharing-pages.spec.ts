import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  alexsShares,
  BOTH_WARNINGS,
  CODE_FOUND,
  ISSUED,
  NO_CODES,
  serveSharingPages,
  SHARE_CODE,
  SHARED_WITH_US,
  THREE_CODES,
  THREE_OFFERS,
  VISITOR_TVS,
} from './sharingPages'

// The sharing pages at phone width: a row's action sits under its text rather than squeezing it,
// and a group of actions wraps or stacks rather than leaving the page or one button behind.
const PHONE = { width: 390, height: 844 }

test.use({ serviceWorkers: 'block', viewport: PHONE })

async function expectNoSidewaysScroll(page: Page) {
  const root = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
}

// A button squeezed narrower than its label clips it; a whole one overflows nowhere that shows.
async function expectWhole(action: Locator) {
  const clipped = await action.evaluate((button) =>
    [button, ...button.querySelectorAll('*')]
      .filter((part) => part.checkVisibility({ opacityProperty: true }))
      .some((part) => part.scrollWidth > part.clientWidth),
  )
  expect(clipped).toBe(false)
}

// Each row is its text, then its action.
async function expectEachActionBelowItsText(rows: Locator) {
  await expect(rows.first()).toBeVisible()
  const placements = await rows.evaluateAll((items) =>
    items.map((item) => {
      const text = item.firstElementChild?.getBoundingClientRect()
      const action = item.lastElementChild?.getBoundingClientRect()
      return text && action ? action.top - text.bottom : null
    }),
  )
  expect(placements.length).toBeGreaterThan(0)
  for (const gap of placements) expect(gap).toBeGreaterThanOrEqual(0)
}

test('each share offer puts its decisions below the offer at phone width', async ({
  page,
  request,
}) => {
  await serveSharingPages(page, request, { ShareOffers: THREE_OFFERS })
  await page.goto('/settings/household/offers')

  await expectEachActionBelowItsText(page.getByRole('listitem'))
  await expectNoSidewaysScroll(page)
})

test('each live code puts Withdraw below the code at phone width', async ({ page, request }) => {
  await serveSharingPages(page, request, { HouseholdShareCodes: THREE_CODES })
  await page.goto('/settings/household/codes')

  await expectEachActionBelowItsText(page.getByRole('listitem'))
  await expectNoSidewaysScroll(page)
})

test('each Profile and TV shared with us puts its action below it at phone width', async ({
  page,
  request,
}) => {
  await serveSharingPages(page, request, {
    SharedWithHousehold: SHARED_WITH_US,
    VisitorDevices: VISITOR_TVS,
  })
  await page.goto('/settings/household/visitors')

  await expect(page.getByRole('listitem')).toHaveCount(3)
  await expectEachActionBelowItsText(page.getByRole('listitem'))
  await expectNoSidewaysScroll(page)
})

test('each share of the Profile puts its action below the Household at phone width', async ({
  page,
  request,
}) => {
  await serveSharingPages(page, request, { ProfileShares: alexsShares })
  await page.goto('/settings/profile/sharing')

  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expectEachActionBelowItsText(page.getByRole('listitem'))
  await expectNoSidewaysScroll(page)
})

test('the review of an offer keeps each action whole and on the page at phone width', async ({
  page,
  request,
}) => {
  await serveSharingPages(page, request, {
    ProfileShares: alexsShares,
    LookUpShareCode: CODE_FOUND,
    ProfileSharePreview: BOTH_WARNINGS,
  })
  await page.goto('/settings/profile/sharing')
  await page.getByRole('button', { name: 'Share with another Household' }).click()
  await page.getByRole('textbox', { name: 'Share code from the other Household' }).fill(SHARE_CODE)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
  for (const name of ['Offer share', 'Back', 'Cancel']) {
    const action = page.getByRole('button', { name, exact: true })
    const box = await action.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width)
    await expectWhole(action)
  }
  await expectNoSidewaysScroll(page)
})

test('an issued code leaves no action alone on a line at phone width', async ({
  page,
  request,
}) => {
  await serveSharingPages(page, request, { HouseholdShareCodes: NO_CODES, IssueShareCode: ISSUED })
  await page.goto('/settings/household/codes')
  await page.getByRole('button', { name: 'Issue a share code' }).click()

  const actions = ['Copy code', 'Copy link', 'Done'].map((name) =>
    page.getByRole('button', { name, exact: true }),
  )
  const tops = await Promise.all(
    actions.map(async (action) => (await action.boundingBox())?.y ?? Number.NaN),
  )
  const lines = new Set(tops.map(Math.round))
  // On one line together, or one to a line, but never two on a line and one left over.
  expect([1, 3]).toContain(lines.size)
  for (const action of actions) await expectWhole(action)
  await expectNoSidewaysScroll(page)
})
