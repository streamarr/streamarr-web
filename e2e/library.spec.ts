import { expect, test, type Page } from '@playwright/test'
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

// The detail answer for a library card: same id and title, so the normalized cache stays coherent.
const movieDetail = (id: string) => ({
  movie: {
    __typename: 'Movie',
    id,
    title: movies[Number(id)].title,
    tagline: null,
    summary: null,
    runtime: 142,
    releaseDate: '2024-05-10',
    contentRating: null,
    genres: [],
    directors: [],
    cast: [],
    ratings: [],
    files: [],
    watchStatus: 'UNWATCHED',
    watchProgress: null,
    backdropImages: [],
    posterImages: [],
  },
})

test('the grid keeps its place when returning from a title', async ({ page, request }) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables & { id?: string }
    }
    if (operation.operationName === 'LibraryPage') {
      return route.fulfill({ json: { data: libraryPage(operation.variables) } })
    }
    if (operation.operationName === 'MovieDetail') {
      return route.fulfill({ json: { data: movieDetail(operation.variables.id!) } })
    }
    return route.continue()
  })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
  const grid = page.locator('[class*="_grid_"]')
  // Scroll three rows down, to the row's measured top, so a whole row sits in view.
  const target = await grid.evaluate((element) => {
    const gridTop = element.getBoundingClientRect().top
    const rowTops = [...element.querySelectorAll('[data-index]')].map(
      (row) => row.getBoundingClientRect().top,
    )
    element.scrollTop = Math.round(rowTops[3] - gridTop)
    return element.scrollTop
  })
  expect(target).toBeGreaterThan(0)
  const href = await grid.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const item = [...element.querySelectorAll('a')].find((candidate) => {
      const box = candidate.getBoundingClientRect()
      return box.top >= bounds.top - 1 && box.bottom <= bounds.bottom
    })
    return item?.getAttribute('href') ?? null
  })
  expect(href).not.toBeNull()
  // Dispatched rather than clicked: a pointer click would first scroll the card into view.
  await page.locator(`a[href="${href}"]`).dispatchEvent('click')
  const opened = movies[Number(href!.split('/').at(-1))].title
  await expect(page.getByRole('heading', { level: 1, name: opened })).toBeVisible()

  await page.goBack()

  // Only the rows near the restored position exist, so wait for any card rather than the first.
  await expect(grid.locator('a').first()).toBeAttached()
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBe(target)
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 375, height: 667 },
  { width: 812, height: 375 },
]) {
  test(`a letter jump keeps the grid on screen and lands its first title at the top at ${viewport.width}x${viewport.height}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport)
    await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
    await request.post(`${STUB_URL}/api/auth/refresh`)
    let releaseSeek!: () => void
    const seek = new Promise<void>((resolve) => {
      releaseSeek = resolve
    })
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
      if (operation.variables.filter?.startLetter === 'N') await seek
      if (operation.variables.before) await backfill
      await route.fulfill({ json: { data: libraryPage(operation.variables) } })
    })
    await page.goto('/library/movies?by=TITLE&direction=ASC')
    await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
    const grid = page.locator('[class*="_grid_"]')
    const gridNode = await grid.elementHandle()
    // Start away from the top, so the landing offset cannot be mistaken for a fresh grid.
    await grid.evaluate((element) => {
      element.scrollTop = 600
    })
    const gridStillMounted = () => gridNode.evaluate((element) => element.isConnected)
    const cardTopOffset = (title: string) =>
      page.getByText(title, { exact: true }).evaluate((element) => {
        const card = element.closest('a')!
        // A virtual row can be between removal and re-render for an instant; poll again then.
        const gridElement = card.closest('[class*="_grid_"]')
        if (!gridElement) return Number.POSITIVE_INFINITY
        return Math.abs(card.getBoundingClientRect().top - gridElement.getBoundingClientRect().top)
      })
    // Only the rows near the viewport exist, so a page that lands above the letter shows through
    // the row before it, and the old rows are whichever were rendered at the press.
    const backfillResponse = () =>
      page.waitForResponse((response) => {
        const body = response.request().postDataJSON() as {
          operationName?: string
          variables?: LibraryPageQueryVariables
        } | null
        return body?.operationName === 'LibraryPage' && body.variables?.before != null
      })
    const oldTitle = (await grid.locator('[class*="_posterTitle_"]').first().textContent())!
    // Counts animation frames painted without a grid from here on, and watches the page for
    // overflow and the rail for movement: a jump must never change the layout around the grid.
    await page.evaluate(() => {
      const main = document.querySelector('main')!
      const rail = document.querySelector('nav[aria-label="Jump to letter"]')!
      const frames = {
        missing: 0,
        initialOverflow: main.scrollHeight - main.clientHeight,
        pageOverflow: main.scrollHeight - main.clientHeight,
        railLefts: new Set<number>([Math.round(rail.getBoundingClientRect().left)]),
        sampling: true,
      }
      Object.assign(window, { gridFrames: frames })
      const sample = () => {
        if (!document.querySelector('[class*="_grid_"]')) frames.missing += 1
        frames.pageOverflow = Math.max(frames.pageOverflow, main.scrollHeight - main.clientHeight)
        frames.railLefts.add(Math.round(rail.getBoundingClientRect().left))
        if (frames.sampling) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })

    const firstBackfill = backfillResponse()
    await page.getByRole('button', { name: 'N', exact: true }).click()

    await expect(page.getByRole('button', { name: 'N', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByText(oldTitle, { exact: true })).toBeAttached()
    expect(await gridStillMounted()).toBe(true)
    releaseSeek()
    await expect(page.getByText('N Title 00', { exact: true })).toBeAttached()
    expect(await gridStillMounted()).toBe(true)
    await expect.poll(() => cardTopOffset('N Title 00')).toBeLessThanOrEqual(1)
    releaseBackfill()
    await firstBackfill
    await expect(page.getByText('M Title 11', { exact: true })).toBeAttached()
    expect(await gridStillMounted()).toBe(true)
    await expect.poll(() => cardTopOffset('N Title 00')).toBeLessThanOrEqual(1)
    const frames = await page.evaluate(() => {
      const { gridFrames } = window as unknown as {
        gridFrames: {
          missing: number
          initialOverflow: number
          pageOverflow: number
          railLefts: Set<number>
          sampling: boolean
        }
      }
      gridFrames.sampling = false
      return {
        missing: gridFrames.missing,
        initialOverflow: gridFrames.initialOverflow,
        pageOverflow: gridFrames.pageOverflow,
        railLefts: [...gridFrames.railLefts],
      }
    })
    expect(frames.missing).toBe(0)
    // A short page may scroll, but a jump never adds to it or moves the rail.
    expect(frames.pageOverflow).toBe(frames.initialOverflow)
    expect(frames.railLefts).toHaveLength(1)

    const secondBackfill = backfillResponse()
    await page.getByRole('button', { name: 'T', exact: true }).click()
    await secondBackfill
    await expect(page.getByText('S Title 11', { exact: true })).toBeAttached()
    await expect.poll(() => cardTopOffset('T Title 00')).toBeLessThanOrEqual(1)
    // A revisit is a cache hit and must land the same way.
    const revisitBackfill = backfillResponse()
    await page.getByRole('button', { name: 'N', exact: true }).click()
    await revisitBackfill
    await expect(page.getByText('M Title 11', { exact: true })).toBeAttached()
    await expect.poll(() => cardTopOffset('N Title 00')).toBeLessThanOrEqual(1)
    expect(await gridStillMounted()).toBe(true)
  })
}

test('a letter jump keeps rows visible until the response arrives, then slides them, unless motion is reduced', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  let releaseSeek!: () => void
  const seek = new Promise<void>((resolve) => {
    releaseSeek = resolve
  })
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (operation.operationName !== 'LibraryPage') return route.continue()
    if (operation.variables.filter?.startLetter === 'N') await seek
    await route.fulfill({ json: { data: libraryPage(operation.variables) } })
  })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
  // Samples what the viewer sees each frame: the grid's vertical offset and opacity, and the
  // first title rendered in it.
  await page.evaluate(() => {
    const frames: { ty: number; opacity: number; first: string | null }[] = []
    Object.assign(window, { frames })
    const sample = () => {
      const grid = document.querySelector<HTMLElement>('[class*="_grid_"]')
      if (grid) {
        const { transform, opacity } = getComputedStyle(grid)
        const ty = transform === 'none' ? 0 : Number(transform.split(',').at(-1)?.slice(0, -1))
        frames.push({
          ty,
          opacity: Number(opacity),
          first: grid.querySelector('[class*="_posterTitle_"]')?.textContent ?? null,
        })
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  type Frame = { ty: number; opacity: number; first: string | null }
  const frames = () => page.evaluate(() => (window as unknown as { frames: Frame[] }).frames)
  const sawFrame = (matches: (frame: Frame) => boolean) => async () =>
    (await frames()).some(matches)
  const oldRows = (frame: Frame) => frame.first === 'A Title 00'

  await page.getByRole('button', { name: 'N', exact: true }).click()
  // A slow response must never leave an invisible grid waiting on the network.
  await page.waitForTimeout(400) // NOSONAR: bounded settle to prove the old rows do not disappear
  expect((await frames()).every((frame) => frame.opacity === 1 && frame.ty === 0)).toBe(true)
  await expect(page.getByText('A Title 00', { exact: true })).toBeAttached()
  expect((await frames()).some((frame) => !oldRows(frame))).toBe(false)
  releaseSeek()
  await expect
    .poll(sawFrame((frame) => oldRows(frame) && frame.ty < -5 && frame.opacity < 0.9))
    .toBe(true)
  await expect(page.getByText('N Title 00', { exact: true })).toBeInViewport()
  // The new rows enter from below.
  await expect.poll(sawFrame((frame) => !oldRows(frame) && frame.ty > 5)).toBe(true)

  await page.getByRole('button', { name: 'A', exact: true }).click()
  await expect(page.getByText('A Title 00', { exact: true })).toBeInViewport()
  // Backward: the rows leave downward and the new ones enter from above.
  await expect
    .poll(sawFrame((frame) => !oldRows(frame) && frame.ty > 5 && frame.opacity < 0.9))
    .toBe(true)
  await expect.poll(sawFrame((frame) => oldRows(frame) && frame.ty < -5)).toBe(true)

  // A viewer who prefers reduced motion arrives with the setting on, so the page loads under it.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const moved: number[] = []
    Object.assign(window, { moved })
    const sample = () => {
      const grid = document.querySelector<HTMLElement>('[class*="_grid_"]')
      const transform = grid ? getComputedStyle(grid).transform : 'none'
      const ty = transform === 'none' ? 0 : Number(transform.split(',').at(-1)?.slice(0, -1))
      if (Math.abs(ty) > 1) moved.push(ty)
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.getByRole('button', { name: 'T', exact: true }).click()
  await expect(page.getByText('T Title 00', { exact: true })).toBeInViewport()
  await page.waitForTimeout(400) // NOSONAR: proving an absence needs a bounded settle, not a condition
  expect(await page.evaluate(() => (window as unknown as { moved: number[] }).moved)).toEqual([])
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
  const grid = page.locator('[class*="_grid_"]')

  for (const { viewport, letter } of [
    { viewport: { width: 1440, height: 900 }, letter: 'B' },
    { viewport: { width: 375, height: 667 }, letter: 'C' },
  ]) {
    await page.setViewportSize(viewport)
    await expect.poll(rowsFitTheWidth(page)).toBe(true)
    // A row that far down is not in the DOM yet, so scroll to it by the grid's row geometry.
    await grid.evaluate(
      (element, index) => {
        const rows = [...element.querySelectorAll('[data-index]')]
        const pitch = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top
        element.scrollTop = Math.floor(index / rows[0].children.length) * pitch
      },
      (letter.charCodeAt(0) - 65) * 12,
    )
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

  // The pills set their own size, so the taller text is applied to them, not inherited from the nav.
  await page.getByRole('navigation', { name: 'Primary' }).evaluate((element) => {
    for (const pill of element.querySelectorAll<HTMLElement>('a, button, span')) {
      pill.style.fontSize = '2rem'
    }
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

test('selecting the URL letter again returns to its first title after scrolling', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const op = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (op.operationName !== 'LibraryPage') return route.continue()
    return route.fulfill({ json: { data: libraryPage(op.variables) } })
  })
  await page.goto('/library/movies?by=TITLE&direction=ASC&letter=N')
  const grid = page.locator('[data-scroll-restoration-id="library-grid"]')
  const landing = page.getByText('N Title 00', { exact: true })
  const nButton = page.getByRole('button', { name: 'N', exact: true })
  const pButton = page.getByRole('button', { name: 'P', exact: true })
  await expect(landing).toBeInViewport()
  await expect(nButton).toHaveAttribute('aria-pressed', 'true')
  const pOffset = await page
    .getByText('P Title 00', { exact: true })
    .evaluate((el) => el.closest('a')!.parentElement!.offsetTop)
  await grid.evaluate((el, offset) => {
    el.scrollTop = offset
  }, pOffset)
  await expect(pButton).toHaveAttribute('aria-pressed', 'true')
  await expect(nButton).toHaveAttribute('aria-pressed', 'false')
  expect(new URL(page.url()).searchParams.get('letter')).toBe('N')
  await nButton.click()
  expect(new URL(page.url()).searchParams.get('letter')).toBe('N')
  await expect
    .poll(() =>
      landing.evaluate((el) => {
        const row = el.closest('a')!.parentElement!
        return Math.abs(row.offsetTop - row.parentElement!.scrollTop)
      }),
    )
    .toBeLessThanOrEqual(1)
})

test('Back after a letter jump restores the previous grid position', async ({ page, request }) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  await page.route('**/graphql', async (route) => {
    const op = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (op.operationName !== 'LibraryPage') return route.continue()
    return route.fulfill({ json: { data: libraryPage(op.variables) } })
  })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
  const grid = page.locator('[data-scroll-restoration-id="library-grid"]')
  await grid.evaluate((el) => {
    el.scrollTop = 600
  })
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBe(600)
  await page.getByRole('button', { name: 'N', exact: true }).click()
  await expect(page.getByText('N Title 00', { exact: true })).toBeInViewport()
  await expect.poll(() => grid.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  await page.goBack()
  await expect(page.getByText('A Title 00', { exact: true })).toBeAttached()
  await expect.poll(() => grid.evaluate((el) => el.scrollTop), { timeout: 1500 }).toBe(600)
})

for (const { seek, failRecovery } of [
  { seek: false, failRecovery: false },
  { seek: true, failRecovery: false },
  { seek: false, failRecovery: true },
]) {
  test(`Back restores the expanded ${seek ? 'letter' : 'forward'} window after changing watched state${failRecovery ? ' and a failed page' : ''}`, async ({
    page,
    request,
  }) => {
    await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
    await request.post(`${STUB_URL}/api/auth/refresh`)
    let watched = false
    let allowRecovery = !failRecovery
    let failedPages = 0
    await page.route('**/graphql', async (route) => {
      const operation = route.request().postDataJSON() as {
        operationName: string
        variables: LibraryPageQueryVariables & { id: string }
      }
      if (operation.operationName === 'LibraryPage') {
        if (watched && operation.variables.after && !allowRecovery) {
          failedPages += 1
          return route.fulfill({ json: { errors: [{ message: 'Page temporarily unavailable' }] } })
        }
        return route.fulfill({ json: { data: libraryPage(operation.variables) } })
      }
      if (operation.operationName === 'MovieDetail') {
        const data = movieDetail(operation.variables.id)
        data.movie.watchStatus = watched ? 'WATCHED' : 'UNWATCHED'
        return route.fulfill({ json: { data } })
      }
      if (operation.operationName === 'MarkWatched') {
        watched = true
        return route.fulfill({ json: { data: { markWatched: true } } })
      }
      return route.continue()
    })
    await page.goto('/library/movies?by=TITLE&direction=ASC')
    await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
    const grid = page.locator('[data-scroll-restoration-id="library-grid"]')
    if (seek) {
      await page.getByRole('button', { name: 'N', exact: true }).click()
      await expect(page.getByText('J Title 00', { exact: true })).toBeAttached()
      await grid.evaluate((element) => {
        element.scrollTop = 0
      })
      await expect(page.getByText('F Title 00', { exact: true })).toBeAttached()
    } else {
      await grid.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect(page.getByText('E Title 00', { exact: true })).toBeAttached()
    }
    const titleName = seek ? 'P Title 00' : 'G Title 00'
    const title = page.getByRole('link', { name: `${titleName} 2024 · 1h 30m`, exact: true })
    await title.evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await expect(title).toBeInViewport()
    const savedPosition = await grid.evaluate((element) => element.scrollTop)
    await title.dispatchEvent('click')
    await page.getByRole('button', { name: 'Mark watched', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Mark unwatched', exact: true })).toBeVisible()
    await page.goBack()
    if (failRecovery) {
      await expect(page.getByRole('alert')).toContainText('Page temporarily unavailable', {
        timeout: 1500,
      })
      await page.waitForTimeout(250) // NOSONAR: bounded settle proves failed pages are not retried automatically
      expect(failedPages).toBe(1)
      allowRecovery = true
      await page.getByRole('button', { name: 'Try again', exact: true }).click()
    }
    await expect(page.getByText(titleName, { exact: true })).toBeInViewport()
    await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBe(savedPosition)
  })
}

test('the grid keeps only the rows near the viewport in the DOM across ten letter jumps', async ({
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
  // The rows that fit the grid, a partial row at each edge, and two rows of overscan each way.
  const { columns, bound } = await grid.evaluate((element) => {
    const tops = [...element.querySelectorAll('a')].map((card) => card.getBoundingClientRect().top)
    const distinct = [...new Set(tops)].sort((a, b) => a - b)
    const columnCount = tops.filter((top) => top === distinct[0]).length
    const rowsThatFit = Math.ceil(element.clientHeight / (distinct[1] - distinct[0])) + 2
    return { columns: columnCount, bound: (rowsThatFit + 4) * columnCount }
  })
  const backfill = () =>
    page.waitForResponse((response) => {
      const body = response.request().postDataJSON() as {
        operationName?: string
        variables?: LibraryPageQueryVariables
      } | null
      return body?.operationName === 'LibraryPage' && body.variables?.before != null
    })

  const counts: number[] = []
  for (const letter of ['N', 'T', 'C', 'X', 'G', 'Q', 'B', 'V', 'K', 'E']) {
    const backfilled = backfill()
    await page.getByRole('button', { name: letter, exact: true }).click()
    await expect(page.getByText(`${letter} Title 00`, { exact: true })).toBeInViewport()
    await backfilled
    await expect(page.getByText(`${letter} Title 00`, { exact: true })).toBeInViewport()
    counts.push(await grid.locator('a').count())
  }
  expect(Math.max(...counts)).toBeLessThanOrEqual(bound)
  expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2 * columns)
})

test('a narrower window re-lays the rows before the frame that resized them paints', async ({
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
  // Resize observers run after layout and before paint, in the order they were created: one
  // created now runs after the grid's own, and sees the rows as the frame will paint them.
  await page.evaluate(() => {
    const grid = document.querySelector('[class*="_grid_"]')!
    const seen = { deliveries: 0, overfullRows: 0, overlappingRows: 0 }
    Object.assign(window, { rowsAtResize: seen })
    new ResizeObserver(() => {
      seen.deliveries += 1
      const rows = [...grid.querySelectorAll<HTMLElement>('[data-index]')]
      for (const [position, row] of rows.entries()) {
        const tracks = getComputedStyle(row).gridTemplateColumns.split(' ').length
        if (row.children.length > tracks) seen.overfullRows += 1
        const previous = rows[position - 1]
        if (
          previous &&
          row.getBoundingClientRect().top < previous.getBoundingClientRect().bottom - 1
        ) {
          seen.overlappingRows += 1
        }
      }
    }).observe(grid)
  })
  const seen = () =>
    page.evaluate(
      () =>
        (window as unknown as { rowsAtResize: { deliveries: number; overfullRows: number } })
          .rowsAtResize,
    )
  await expect.poll(async () => (await seen()).deliveries).toBeGreaterThan(0)
  const deliveriesBefore = (await seen()).deliveries
  // The third card moves to a row of its own at two columns; focus must move with it.
  await page.getByRole('link', { name: 'A Title 02' }).focus()

  await page.setViewportSize({ width: 375, height: 667 })

  await expect.poll(async () => (await seen()).deliveries).toBeGreaterThan(deliveriesBefore)
  await expect.poll(rowsFitTheWidth(page)).toBe(true)
  expect(await seen()).toMatchObject({ overfullRows: 0, overlappingRows: 0 })
  await expect(page.getByRole('link', { name: 'A Title 02' })).toBeFocused()
  // Re-focusing scrolls the card into view only if needed, by the rows' final positions.
  await expect(page.getByRole('link', { name: 'A Title 02' })).toBeInViewport({ ratio: 1 })
})

// Rows are re-laid for a new width once the grid has measured it.
function rowsFitTheWidth(page: Page) {
  return () =>
    page.locator('[class*="_grid_"]').evaluate((element) => {
      const row = element.querySelector('[data-index]')!
      return row.children.length === getComputedStyle(row).gridTemplateColumns.split(' ').length
    })
}

test('every row is the same height, however long the titles in it run', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  const longTitle = (title: string) =>
    `${title} and a subtitle long enough to wrap onto a second and a third line in any column`
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (operation.operationName !== 'LibraryPage') return route.continue()
    const data = libraryPage(operation.variables)
    // One title in the first row runs long; the rows below it must not move.
    const [first, ...rest] = data.library.items.edges ?? []
    if (first?.node) {
      const node = { ...first.node, title: longTitle(first.node.title ?? '') }
      data.library.items.edges = [{ ...first, node }, ...rest]
    }
    await route.fulfill({ json: { data } })
  })
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText(longTitle('A Title 00'), { exact: true })).toBeVisible()
  const grid = page.locator('[class*="_grid_"]')
  const rows = await grid.evaluate((element) =>
    [...element.querySelectorAll<HTMLElement>('[data-index]')].map((row) => {
      const box = row.getBoundingClientRect()
      const titles = [...row.querySelectorAll<HTMLElement>('[class*="_posterTitle_"]')]
      return {
        top: Math.round(box.top),
        height: Math.round(box.height),
        titleHeights: titles.map((title) => Math.round(title.getBoundingClientRect().height)),
      }
    }),
  )
  expect(rows.length).toBeGreaterThan(2)
  const [first, second] = rows
  const oneLine = first.titleHeights[0]
  expect(rows.map((row) => row.titleHeights)).toEqual(
    rows.map((row) => row.titleHeights.map(() => oneLine)),
  )
  expect(rows.map((row) => row.height)).toEqual(rows.map(() => first.height))
  // Rows are placed by the measured pitch, so a taller first row would overlap the second.
  const pitch = second.top - first.top
  expect(pitch).toBeGreaterThanOrEqual(first.height)
  expect(rows.map((row) => row.top - first.top)).toEqual(rows.map((_, index) => index * pitch))
})
