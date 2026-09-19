import { expect, test } from '@playwright/test'
import type { LibraryPageQuery, LibraryPageQueryVariables } from '../src/graphql/generated/graphql'
import { STUB_URL } from './ports'

// Use real layout and IntersectionObserver; intercept only the library API response.
test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })

const movies = Array.from({ length: 26 * 12 }, (_, index) => {
  const title = `${String.fromCharCode(65 + Math.floor(index / 12))} Title ${String(index % 12).padStart(2, '0')}`
  return {
    __typename: 'Movie' as const,
    id: String(index),
    title,
    titleSort: title,
    releaseDate: '2024-01-01',
    runtime: 90,
    watchStatus: 'UNWATCHED' as const,
    watchProgress: null,
    images: [],
  }
})

function libraryPage(variables: LibraryPageQueryVariables): LibraryPageQuery {
  const start = variables.before
    ? Math.max(0, Number(variables.before) - (variables.last ?? 48))
    : variables.after
      ? Number(variables.after) + 1
      : variables.filter?.startLetter
        ? (variables.filter.startLetter.charCodeAt(0) - 65) * 12
        : 0
  const end = variables.before
    ? Number(variables.before)
    : Math.min(movies.length, start + (variables.first ?? 48))
  const nodes = movies.slice(start, end)
  const metadata = { __typename: 'Library' as const, id: 'movies', name: 'Movies' }
  return {
    library: {
      ...metadata,
      status: 'HEALTHY',
      scanCompletedOn: null,
      alphabetIndex: Array.from({ length: 26 }, (_, index) => ({
        letter: String.fromCharCode(
          65 + index,
        ) as LibraryPageQuery['library']['alphabetIndex'][number]['letter'],
        count: 12,
      })),
      items: {
        edges: nodes.map((node) => ({ cursor: node.id, node })),
        pageInfo: {
          hasNextPage: end < movies.length,
          hasPreviousPage: start > 0,
          startCursor: nodes[0]?.id ?? null,
          endCursor: nodes.at(-1)?.id ?? null,
        },
      },
    },
  }
}

test('a letter jump stays on its target when the earlier page arrives', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  let releaseBackfill!: () => void
  const backfill = new Promise<void>((resolve) => {
    releaseBackfill = resolve
  })
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (operation.operationName !== 'LibraryPage') return route.continue()
    if (operation.variables.before) await backfill
    await route.fulfill({ json: { data: libraryPage(operation.variables) } })
  })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'N', exact: true }).click()
  await expect(page.getByText('N Title 00', { exact: true })).toBeInViewport()
  releaseBackfill()
  await expect(page.getByText('J Title 00', { exact: true })).toBeAttached()
  await expect(page.getByText('N Title 00', { exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'T', exact: true }).click()
  await expect(page.getByText('P Title 00', { exact: true })).toBeAttached()
  await expect(page.getByText('T Title 00', { exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'N', exact: true }).click()
  await expect(page.getByText('F Title 00', { exact: true })).toBeAttached()
  await expect(page.getByText('N Title 00', { exact: true })).toBeInViewport()
})

test('prefetching follows the visible grid height on a phone and after rotation', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  let forwardPages = 0
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (operation.operationName !== 'LibraryPage') return route.continue()
    if (operation.variables.after) forwardPages += 1
    await route.fulfill({ json: { data: libraryPage(operation.variables) } })
  })
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
  const grid = page.locator('[class*="_grid_"]')

  for (const viewport of [
    { width: 375, height: 667 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport)
    // Let layout and resize notifications settle before approaching the loading boundary.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    )
    const pagesBefore = forwardPages
    // Outside the half-screen prefetch zone, the next page must remain unloaded.
    await grid.evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight * 1.75
    })
    // Allow the real observer and its network request to run before asserting their absence.
    await page.waitForTimeout(200) // NOSONAR: proving an absence needs a bounded settle, not a condition
    expect(forwardPages).toBe(pagesBefore)

    await grid.evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight * 1.25
    })
    await expect.poll(() => forwardPages).toBe(pagesBefore + 1)
    await expect(
      page.getByText(`${String.fromCharCode(65 + forwardPages * 4)} Title 00`, { exact: true }),
    ).toBeAttached()
  }
})

test('the alphabet highlight follows vertical scrolling on desktop and a phone', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (operation.operationName !== 'LibraryPage') return route.continue()
    await route.fulfill({ json: { data: libraryPage(operation.variables) } })
  })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()

  for (const { viewport, letter } of [
    { viewport: { width: 1440, height: 900 }, letter: 'B' },
    { viewport: { width: 375, height: 667 }, letter: 'C' },
  ]) {
    await page.setViewportSize(viewport)
    await page.getByText(`${letter} Title 00`, { exact: true }).evaluate((element) => {
      element.scrollIntoView({ block: 'start' })
    })
    await expect(page.getByRole('button', { name: letter, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }
})

test('the requested letter stays visible in the mobile alphabet rail', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (operation.operationName !== 'LibraryPage') return route.continue()
    await route.fulfill({ json: { data: libraryPage(operation.variables) } })
  })
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/library/movies?by=TITLE&direction=ASC&letter=N')
  await expect(page.getByText('N Title 00', { exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'N', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'N', exact: true })).toBeInViewport({ ratio: 0.99 })
  const renderedTitles = await page.locator('[class*="_posterTitle_"]').allTextContents()
  expect(renderedTitles).toHaveLength(new Set(renderedTitles).size)
})

test('the Library viewport adapts when navigation text makes the header taller', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (operation.operationName !== 'LibraryPage') return route.continue()
    await route.fulfill({ json: { data: libraryPage(operation.variables) } })
  })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
  const grid = page.locator('[class*="_grid_"]')
  const initialHeight = await grid.evaluate((element) => element.clientHeight)

  await page.getByRole('navigation', { name: 'Primary' }).evaluate((element) => {
    element.style.fontSize = '2rem'
  })

  await expect
    .poll(() => grid.evaluate((element) => element.clientHeight))
    .toBeLessThan(initialHeight)
  const dimensions = await page.evaluate(() => ({
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: document.documentElement.clientHeight,
    contentHeight: document.querySelector('main')!.scrollHeight,
    contentViewportHeight: document.querySelector('main')!.clientHeight,
  }))
  expect(dimensions.pageHeight).toBeLessThanOrEqual(dimensions.viewportHeight)
  expect(dimensions.contentHeight).toBeLessThanOrEqual(dimensions.contentViewportHeight)
})

test('a short Library screen preserves a readable grid and lets the page scroll to it', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (operation.operationName !== 'LibraryPage') return route.continue()
    await route.fulfill({ json: { data: libraryPage(operation.variables) } })
  })
  await page.setViewportSize({ width: 375, height: 400 })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  const firstTitle = page.getByText('A Title 00', { exact: true })
  await expect(firstTitle).toBeAttached()
  const posterHeight = await firstTitle.locator('..').evaluate((element) => element.clientHeight)
  const grid = page.locator('[class*="_grid_"]')
  expect(await grid.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(
    posterHeight,
  )

  await firstTitle.scrollIntoViewIfNeeded()
  await expect(firstTitle).toBeInViewport({ ratio: 1 })
  const sort = page.getByRole('button', { name: 'Sort: Title' })
  await sort.scrollIntoViewIfNeeded()
  await expect(sort).toBeInViewport({ ratio: 1 })
})

test.describe('touch alphabet', () => {
  test.use({ hasTouch: true })

  test('keeps comfortable targets after rotation and can reach the last letter', async ({
    page,
    request,
  }) => {
    await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
    await request.post(`${STUB_URL}/api/auth/refresh`)
    await page.route('**/graphql', async (route) => {
      const operation = route.request().postDataJSON() as {
        operationName: string
        variables: LibraryPageQueryVariables
      }
      if (operation.operationName !== 'LibraryPage') return route.continue()
      await route.fulfill({ json: { data: libraryPage(operation.variables) } })
    })
    await page.goto('/library/movies?by=TITLE&direction=ASC')
    const rail = page.getByRole('navigation', { name: 'Jump to letter' })
    await expect(rail).toBeVisible()
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

    for (const viewport of [
      { width: 375, height: 667 },
      { width: 812, height: 375 },
    ]) {
      await page.setViewportSize(viewport)
      const bounds = await rail.getByRole('button', { name: 'A', exact: true }).boundingBox()
      expect(bounds!.width).toBeGreaterThanOrEqual(44)
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
      const lastLetter = rail.getByRole('button', { name: 'Z', exact: true })
      await rail.getByRole('button', { name: 'A', exact: true }).focus()
      await lastLetter.focus()
      await expect(lastLetter).toBeInViewport({ ratio: 0.99 })
    }
  })
})

for (const { orientation, viewport, minPosterShare } of [
  { orientation: 'portrait', viewport: { width: 375, height: 667 }, minPosterShare: 0.4 },
  { orientation: 'landscape', viewport: { width: 812, height: 375 }, minPosterShare: 0.2 },
]) {
  test(`Library cards and controls fit a phone in ${orientation}`, async ({
    page,
    request,
  }, testInfo) => {
    await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
    await request.post(`${STUB_URL}/api/auth/refresh`)
    await page.route('**/graphql', async (route) => {
      const operation = route.request().postDataJSON() as {
        operationName: string
        variables: LibraryPageQueryVariables
      }
      if (operation.operationName !== 'LibraryPage') return route.continue()
      await route.fulfill({ json: { data: libraryPage(operation.variables) } })
    })
    await page.setViewportSize(viewport)
    await page.goto('/library/movies?by=TITLE&direction=ASC')
    await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      height: document.documentElement.clientHeight,
      contentHeight: document.documentElement.scrollHeight,
    }))
    expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.width)
    expect(dimensions.contentHeight).toBeLessThanOrEqual(dimensions.height)
    await expect(page.getByRole('button', { name: 'Sort: Title' })).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: 'In progress', exact: true })).toBeInViewport({
      ratio: 1,
    })
    const gridWidth = await page
      .locator('[class*="_grid_"]')
      .evaluate((element) => element.clientWidth)
    const posterWidth = await page
      .getByText('A Title 00', { exact: true })
      .evaluate((element) => element.parentElement!.clientWidth)
    // Keep posters readable: two columns in portrait, up to four in landscape.
    expect(posterWidth).toBeGreaterThan(gridWidth * minPosterShare)
    expect(posterWidth).toBeLessThan(gridWidth * 0.6)
    const lastLetter = page.getByRole('button', { name: 'Z', exact: true })
    await lastLetter.focus()
    await expect(lastLetter).toBeInViewport({ ratio: 0.99 })
    await page.screenshot({ path: testInfo.outputPath('library.png') })
  })
}
