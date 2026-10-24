import { expect, test, type Page } from '@playwright/test'
import type { LibraryPageQuery, LibraryPageQueryVariables } from '../src/graphql/generated/graphql'
import { mediaEdge } from '../src/test/libraryContentsFixtures'
import { STUB_URL } from './ports'

// Use real layout and IntersectionObserver; intercept only the library API response.
test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })

const movies = moviesPerLetter(12)

function moviesPerLetter(perLetter: number) {
  return Array.from({ length: 26 * perLetter }, (_, index) => movie(index, perLetter))
}

function movie(index: number, perLetter: number) {
  const title = `${String.fromCharCode(65 + Math.floor(index / perLetter))} Title ${String(index % perLetter).padStart(2, '0')}`
  return {
    __typename: 'Movie' as const,
    id: String(index),
    title,
    titleSort: title,
    releaseDate: '2024-01-01',
    runtime: 90,
    watchStatus: 'UNWATCHED' as const,
    lastWatchedAt: null,
    watchProgress: null,
    images: [],
  }
}

function libraryPage(variables: LibraryPageQueryVariables, library = movies): LibraryPageQuery {
  const perLetter = library.length / 26
  const start = variables.before
    ? Math.max(0, Number(variables.before) - (variables.last ?? 48))
    : variables.after
      ? Number(variables.after) + 1
      : variables.filter?.startLetter
        ? (variables.filter.startLetter.charCodeAt(0) - 65) * perLetter
        : 0
  const end = variables.before
    ? Number(variables.before)
    : Math.min(library.length, start + (variables.first ?? 48))
  const nodes = library.slice(start, end)
  const metadata = { __typename: 'Library' as const, id: 'movies', name: 'Movies' }
  return {
    library: {
      ...metadata,
      status: 'HEALTHY',
      scanCompletedOn: null,
      itemCount: library.length,
      alphabetIndex: Array.from({ length: 26 }, (_, index) => ({
        letter: String.fromCharCode(
          65 + index,
        ) as LibraryPageQuery['library']['alphabetIndex'][number]['letter'],
        count: perLetter,
      })),
      items: {
        edges: nodes.map((node) => mediaEdge({ cursor: node.id, node })),
        pageInfo: {
          hasNextPage: end < library.length,
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 375, height: 667 },
  { width: 812, height: 375 },
]) {
  test(`the grid keeps its place when returning from a title at ${viewport.width}x${viewport.height}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport)
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
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 375, height: 667 },
  { width: 812, height: 375 },
]) {
  test(`a letter jump keeps the grid on screen and lands its first title's row at the top at ${viewport.width}x${viewport.height}`, async ({
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
    // The letter waits for the titles before it, so its row arrives full.
    await page.waitForTimeout(250) // NOSONAR: bounded settle proves the letter is held back
    await expect(page.getByText('N Title 00', { exact: true })).not.toBeAttached()
    expect(await gridStillMounted()).toBe(true)
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

// Five and seven columns, which 48 titles would leave a partial row in, and a phone's two.
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1700, height: 900 },
  { width: 375, height: 667 },
]) {
  test(`every page of titles ends on a whole row at ${viewport.width}x${viewport.height}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport)
    await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
    await request.post(`${STUB_URL}/api/auth/refresh`)
    const pageSizes: number[] = []
    await page.route('**/graphql', async (route) => {
      const operation = route.request().postDataJSON() as {
        operationName: string
        variables: LibraryPageQueryVariables
      }
      if (operation.operationName !== 'LibraryPage') return route.continue()
      pageSizes.push(operation.variables.first ?? 0)
      await route.fulfill({ json: { data: libraryPage(operation.variables) } })
    })
    await page.goto('/library/movies?by=TITLE&direction=ASC')
    await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
    const grid = page.locator('[class*="_grid_"]')
    const columns = await columnCount(page)
    expect(columns).toBeGreaterThan(1)

    await grid.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })

    await expect.poll(() => pageSizes.length).toBeGreaterThan(1)
    expect(pageSizes.filter((size) => size % columns !== 0)).toEqual([])
  })
}

// Six columns break the window loaded at five part-way through a row, until the page before it.
for (const resizeTo of [null, { width: 1500, height: 800 }]) {
  test(`titles keep their columns from a letter jump back to the start of the library${resizeTo ? ' after a resize' : ''}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
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
    const columns = await columnCount(page)
    expect(columns).toBe(5)
    // Records every title that moves sideways between two painted frames.
    await page.evaluate(() => {
      const moved = new Set<string>()
      let previous = new Map<string, number>()
      Object.assign(window, { movedSideways: moved })
      const sample = () => {
        const grid = document.querySelector('[data-scroll-restoration-id="library-grid"]')
        const current = new Map<string, number>()
        for (const card of grid?.querySelectorAll('[role="gridcell"]') ?? []) {
          const title = card.querySelector('[class*="_posterTitle_"]')?.textContent ?? ''
          current.set(title, Math.round(card.getBoundingClientRect().left))
          const before = previous.get(title)
          if (before !== undefined && before !== current.get(title)) moved.add(title)
        }
        previous = current
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    const left = (title: string) =>
      page.getByText(title, { exact: true }).evaluate((element) => {
        const box = element.closest('[role="gridcell"]')!.getBoundingClientRect()
        return { left: Math.round(box.left), top: Math.round(box.top) }
      })

    await page.getByRole('button', { name: 'N', exact: true }).click()

    // N's first title is the library's 157th, the second in its row.
    await expect(page.getByText('N Title 00', { exact: true })).toBeInViewport()
    const landing = await left('N Title 00')
    const before = await left('M Title 11')
    expect(before.top).toBe(landing.top)
    expect(before.left).toBeLessThan(landing.left)
    const grid = page.locator('[data-scroll-restoration-id="library-grid"]')
    if (resizeTo) {
      await page.setViewportSize(resizeTo)
      await expect.poll(rowsFitTheWidth(page)).toBe(true)
      // A resize moves every row; only what follows it must keep titles in their columns.
      await page.evaluate(() =>
        (window as unknown as { movedSideways: Set<string> }).movedSideways.clear(),
      )
    }
    await expect
      .poll(async () => {
        await grid.evaluate((element) => {
          element.scrollTop = 0
        })
        return grid.locator('[data-edge="start"]').count()
      })
      .toBe(0)
    await grid.evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(page.getByText('A Title 00', { exact: true })).toBeInViewport()
    const firstRow = grid.locator('[data-index="0"] [role="gridcell"]')
    await expect(firstRow).toHaveCount(await columnCount(page))
    const moved = await page.evaluate(() => [
      ...(window as unknown as { movedSideways: Set<string> }).movedSideways,
    ])
    expect(moved).toEqual([])
  })
}

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
  const landing = page.getByText('N Title 00', { exact: true })
  const nButton = page.getByRole('button', { name: 'N', exact: true })
  const pButton = page.getByRole('button', { name: 'P', exact: true })
  await expect(landing).toBeInViewport()
  await expect(nButton).toHaveAttribute('aria-pressed', 'true')
  await scrollToMovie(page, 180)
  await expect(pButton).toHaveAttribute('aria-pressed', 'true')
  await expect(nButton).toHaveAttribute('aria-pressed', 'false')
  expect(new URL(page.url()).searchParams.get('letter')).toBe('N')
  await nButton.click()
  expect(new URL(page.url()).searchParams.get('letter')).toBe('N')
  await expect
    .poll(() =>
      landing.evaluate((el) => {
        const card = el.closest('a')!
        const gridElement = card.closest('[data-scroll-restoration-id="library-grid"]')
        if (!gridElement) return Number.POSITIVE_INFINITY
        return Math.abs(card.getBoundingClientRect().top - gridElement.getBoundingClientRect().top)
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

// The retained library consumer owns membership for every sort. Recovery restores its expanded
// window after reading again, including when a continuation fails.
for (const { seek, sort, failRecovery } of [
  { seek: false, sort: 'TITLE', failRecovery: false },
  { seek: true, sort: 'TITLE', failRecovery: false },
  { seek: false, sort: 'LAST_WATCHED', failRecovery: false },
  { seek: false, sort: 'LAST_WATCHED', failRecovery: true },
]) {
  test(`Back restores the expanded ${seek ? 'letter' : 'forward'} window in ${sort} order after changing watched state${failRecovery ? ' and a failed page' : ''}`, async ({
    page,
    request,
  }) => {
    await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
    await request.post(`${STUB_URL}/api/auth/refresh`)
    let watched = false
    let allowRecovery = !failRecovery
    let failedPages = 0
    let firstLoaded = 312
    let lastLoaded = -1
    let libraryReloadsAfterMark = 0
    await page.route('**/graphql', async (route) => {
      const operation = route.request().postDataJSON() as {
        operationName: string
        variables: LibraryPageQueryVariables & { id: string; input: { itemId: string } }
      }
      if (operation.operationName === 'LibraryPage') {
        const reload = !operation.variables.before && !operation.variables.after
        if (watched && reload) libraryReloadsAfterMark += 1
        if (watched && operation.variables.after && !allowRecovery) {
          failedPages += 1
          return route.fulfill({
            json: {
              errors: [
                { message: 'Page temporarily unavailable', extensions: { code: 'UNAVAILABLE' } },
              ],
            },
          })
        }
        const data = libraryPage(operation.variables)
        const nodes = data.library.items.edges ?? []
        if (reload) {
          firstLoaded = Number(nodes[0]?.cursor)
          lastLoaded = Number(nodes.at(-1)?.cursor)
        } else {
          firstLoaded = Math.min(firstLoaded, Number(nodes[0]?.cursor))
          lastLoaded = Math.max(lastLoaded, Number(nodes.at(-1)?.cursor))
        }
        return route.fulfill({ json: { data } })
      }
      if (operation.operationName === 'MovieDetail') {
        const data = movieDetail(operation.variables.id)
        data.movie.watchStatus = watched ? 'WATCHED' : 'UNWATCHED'
        return route.fulfill({ json: { data } })
      }
      if (operation.operationName === 'MarkWatched') {
        watched = true
        const item = {
          __typename: 'Movie',
          id: operation.variables.input.itemId,
          watchStatus: 'WATCHED',
          watchProgress: null,
        }
        return route.fulfill({ json: { data: { markWatched: { item, userErrors: [] } } } })
      }
      return route.continue()
    })
    await page.goto(`/library/movies?by=${sort}&direction=${sort === 'TITLE' ? 'ASC' : 'DESC'}`)
    await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
    const grid = page.locator('[data-scroll-restoration-id="library-grid"]')
    if (seek) {
      await page.getByRole('button', { name: 'N', exact: true }).click()
      await expect.poll(() => firstLoaded).toBe(108)
      await expect(page.getByText('M Title 11', { exact: true })).toBeAttached()
      await expect.poll(() => grid.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
      await grid.evaluate((element) => {
        element.scrollTop = 0
      })
      await expect.poll(() => firstLoaded).toBe(60)
    } else {
      await grid.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect.poll(() => lastLoaded).toBe(95)
    }
    const titleName = seek ? 'P Title 00' : 'G Title 00'
    const title = page.getByRole('link', { name: `${titleName} 2024 · 1h 30m`, exact: true })
    await scrollToMovie(page, seek ? 180 : 72)
    await expect(title).toBeInViewport()
    const savedPosition = await grid.evaluate((element) => element.scrollTop)
    await title.dispatchEvent('click')
    await page.getByRole('button', { name: 'Mark watched', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Mark unwatched', exact: true })).toBeVisible()
    if (failRecovery) {
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await expect.poll(() => libraryReloadsAfterMark).toBe(1)
    }
    await page.goBack()
    if (failRecovery) {
      await expect(page.getByRole('alert')).toContainText('Page temporarily unavailable', {
        timeout: 1500,
      })
      await page.waitForTimeout(250) // NOSONAR: bounded settle proves failed pages are not retried automatically
      expect(failedPages).toBe(1)
      allowRecovery = true
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
    }
    await expect(page.getByText(titleName, { exact: true })).toBeInViewport()
    await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBe(savedPosition)
    expect(libraryReloadsAfterMark > 0).toBe(failRecovery)
    if (sort === 'TITLE') {
      await expect(page.getByRole('link', { name: `Watched ${titleName} 2024` })).toBeVisible()
    }
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
  // Re-focusing scrolls the card into view only if needed, by the rows' final positions. Scroll
  // offsets are whole pixels, so a card aligned flush with the grid's edge may overhang it by
  // under a pixel.
  const gridBox = await page.locator('[class*="_grid_"]').boundingBox()
  const cardBox = await page.getByRole('link', { name: 'A Title 02' }).boundingBox()
  expect(cardBox!.y).toBeGreaterThan(gridBox!.y - 1)
  expect(cardBox!.y + cardBox!.height).toBeLessThan(gridBox!.y + gridBox!.height + 1)
})

function columnCount(page: Page) {
  return page
    .locator('[class*="_grid_"] [data-index]')
    .first()
    .evaluate((row) => getComputedStyle(row).gridTemplateColumns.split(' ').length)
}

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

// Scroll from the rendered row's known movie to a loaded movie that may not be mounted yet.
async function scrollToMovie(page: Page, movieIndex: number) {
  await page.locator('[data-scroll-restoration-id="library-grid"]').evaluate((grid, index) => {
    const rows = [...grid.querySelectorAll<HTMLElement>('[data-index]')]
    const first = rows[0]
    const firstLink = first.querySelector('a')!
    const firstId = Number(new URL(firstLink.href).pathname.split('/').at(-1))
    const columns = first.children.length
    const pitch = rows[1].getBoundingClientRect().top - first.getBoundingClientRect().top
    const rowTop =
      first.getBoundingClientRect().top - grid.getBoundingClientRect().top + grid.scrollTop
    grid.scrollTop = rowTop + Math.floor((index - firstId) / columns) * pitch
  }, movieIndex)
}

test('scrolling far unloads the titles left behind without moving the rows in view, and scrolling back loads them again', async ({
  page,
  request,
}) => {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  const longLibrary = moviesPerLetter(24)
  const backward: string[] = []
  await page.route('**/graphql', async (route) => {
    const operation = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    if (operation.operationName !== 'LibraryPage') return route.continue()
    if (operation.variables.before) backward.push(operation.variables.before)
    await route.fulfill({ json: { data: libraryPage(operation.variables, longLibrary) } })
  })
  await page.goto('/library/movies?by=TITLE&direction=ASC')
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
  const grid = page.locator('[class*="_grid_"]')
  // The title in the top visible row, and how far below the grid's top edge it sits.
  const topCard = () =>
    grid.evaluate((element) => {
      const gridTop = element.getBoundingClientRect().top
      const titles = [...element.querySelectorAll<HTMLElement>('[class*="_posterTitle_"]')]
      const card = titles.find((title) => title.getBoundingClientRect().bottom > gridTop)!
      return { title: card.textContent, offset: card.getBoundingClientRect().top - gridTop }
    })
  const offsetOf = (title: string) =>
    grid.evaluate((element, wanted) => {
      const titles = [...element.querySelectorAll<HTMLElement>('[class*="_posterTitle_"]')]
      const card = titles.find((candidate) => candidate.textContent === wanted)
      return card ? card.getBoundingClientRect().top - element.getBoundingClientRect().top : null
    }, title)

  // A screen at a time to the last title; whatever unloads above, the rows in view stay put.
  while (!(await page.getByText('Z Title 23', { exact: true }).isVisible())) {
    await grid.evaluate((element) => {
      element.scrollTop += element.clientHeight
    })
    const before = await topCard()
    // A bounded settle: the unload and any page load run within it, and must not move the row.
    await page.waitForTimeout(150)
    expect(await offsetOf(before.title)).toBeCloseTo(before.offset, 0)
  }
  await expect(grid.locator('[data-edge="start"]')).toBeAttached()

  await expect
    .poll(() =>
      grid.evaluate((element) => {
        element.scrollTop = 0
        return element.querySelector('[data-edge="start"]') === null
      }),
    )
    .toBe(true)
  await expect(page.getByText('A Title 00', { exact: true })).toBeVisible()
  expect(backward.length).toBeGreaterThan(0)
})
