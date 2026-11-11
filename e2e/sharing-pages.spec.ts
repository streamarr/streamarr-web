import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
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
// and a group of actions wraps or stacks rather than leaving the page or one button behind. At
// every width, the blocks of a panel and the panels of a page share their content edges.
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

test.use({ serviceWorkers: 'block', viewport: PHONE })

async function boxOf(element: Locator) {
  const box = await element.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

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

/** Opens the review of an offer of Alex to Cabin, with both warnings, and returns its actions. */
async function openTheReview(page: Page, request: APIRequestContext) {
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
  return ['Send invitation', 'Back', 'Cancel'].map((name) =>
    page.getByRole('button', { name, exact: true }),
  )
}

test('the review of an offer puts Send invitation on a line of its own, then Back and Cancel together, each whole, at phone width', async ({
  page,
  request,
}) => {
  const actions = await openTheReview(page, request)
  for (const action of actions) await expectWhole(action)
  await expectNoSidewaysScroll(page)

  const form = await boxOf(page.getByTestId('share-form'))
  const [offer, back, cancel] = await Promise.all(actions.map(boxOf))
  // Send invitation spans the form; Back and Cancel share the line under it, edge to edge.
  expect(offer.x).toBeCloseTo(form.x, 0)
  expect(offer.x + offer.width).toBeCloseTo(form.x + form.width, 0)
  expect(back.y).toBeGreaterThanOrEqual(offer.y + offer.height)
  expect(Math.round(cancel.y)).toBe(Math.round(back.y))
  expect(back.x).toBeCloseTo(form.x, 0)
  expect(cancel.x + cancel.width).toBeCloseTo(form.x + form.width, 0)
})

// A 320 pixel phone zoomed to 125%: too narrow for Back and Cancel to share a line.
test('the review of an offer keeps each action whole and inside the form at 256 pixels wide', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 256, height: 844 })
  const actions = await openTheReview(page, request)

  const form = await boxOf(page.getByTestId('share-form'))
  for (const action of actions) {
    await expectWhole(action)
    const box = await boxOf(action)
    expect(box.x).toBeGreaterThanOrEqual(form.x)
    expect(box.x + box.width).toBeLessThanOrEqual(form.x + form.width)
  }
})

test('the share form sits under the list a full-width hairline apart, as each row does, at desktop width', async ({
  page,
  request,
}) => {
  await page.setViewportSize(DESKTOP)
  await serveSharingPages(page, request, { ProfileShares: alexsShares })
  await page.goto('/settings/profile/sharing')
  await page.getByRole('button', { name: 'Share with another Household' }).click()

  const lastRow = page.getByRole('listitem').last()
  const form = page.getByTestId('share-form')
  await expect(form).toBeVisible()
  const [row, formBox] = await Promise.all([boxOf(lastRow), boxOf(form)])
  expect(formBox.x).toBeCloseTo(row.x, 0)
  expect(formBox.width).toBeCloseTo(row.width, 0)
  expect(formBox.y).toBeGreaterThan(row.y + row.height)
  const divider = (element: Element) => getComputedStyle(element).borderTop
  expect(await form.evaluate(divider)).toBe(await lastRow.evaluate(divider))
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

test('an issued code shares its content edges with Live codes below it at phone and desktop width', async ({
  page,
  request,
}) => {
  await serveSharingPages(page, request, { HouseholdShareCodes: NO_CODES, IssueShareCode: ISSUED })
  await page.goto('/settings/household/codes')
  await page.getByRole('button', { name: 'Issue a share code' }).click()
  const code = page.getByText(SHARE_CODE, { exact: true })
  const liveCodes = page.getByRole('heading', { name: 'Live codes' })
  await expect(code).toBeVisible()

  for (const viewport of [PHONE, DESKTOP]) {
    await page.setViewportSize(viewport)
    const [issued, live] = await Promise.all([boxOf(code), boxOf(liveCodes)])
    expect(issued.x, `left edge at ${viewport.width}px`).toBeCloseTo(live.x, 0)
    expect(issued.x + issued.width, `right edge at ${viewport.width}px`).toBeCloseTo(
      live.x + live.width,
      0,
    )
  }
})
