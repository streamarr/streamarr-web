import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type {
  LibraryPageQuery,
  LibraryPageQueryVariables,
} from '../../src/graphql/generated/graphql'
import { watchingConnection } from '../../src/test/continueWatchingFixtures'
import { LIBRARY, mediaEdge, movie } from '../../src/test/libraryContentsFixtures'
import { meFixture, profileFixture } from '../../src/test/meFixture'
import { routeGraphqlSocket } from '../graphqlSocket'
import { STUB_URL } from '../ports'

// Replays a Movies scan into an empty library open in title order: each movie arrives as one
// addition and two updates, and the letter counts change every few movies, as a real scan sends
// them. Reports how far the page falls behind and how busy its main thread gets.
const TITLES = Number(process.env.REPLAY_TITLES ?? 1000)
const MESSAGES_PER_SECOND = Number(process.env.REPLAY_RATE ?? 60)
const CHECKPOINT = Number(process.env.REPLAY_CHECKPOINT ?? 250)
const COUNTS_EVERY = 7
// Set to a title count to record a CPU profile of the next 100 titles in Chromium.
const PROFILE_FROM = Number(process.env.REPLAY_PROFILE ?? 0)
// The library the scrolling replay pages through, and how often it reports.
const LIBRARY_TITLES = Number(process.env.REPLAY_LIBRARY ?? 10_000)
const SCROLL_CHECKPOINT = Number(process.env.REPLAY_SCROLL_CHECKPOINT ?? 1000)

test.use({ serviceWorkers: 'block', viewport: { width: 1200, height: 900 } })
test.setTimeout(30 * 60_000)

const me = meFixture({ scope: 'profile', profiles: [profileFixture({ selected: true })] })

test('replay a Movies scan into an empty library', async ({ page, request, browserName }) => {
  const socket = await openReplay({ page, request, libraryPage: emptyLibrary })
  await page.goto(`/library/${LIBRARY}?by=TITLE&direction=ASC`)
  await expect(page.getByText('No items match this filter.')).toBeVisible()
  await expect.poll(() => socket.isLive('LibraryCountsChanged')).toBe(true)
  const heap = await heapReader(page, browserName)
  const profiler =
    PROFILE_FROM > 0 && browserName === 'chromium' ? await page.context().newCDPSession(page) : null
  await profiler?.send('Profiler.enable')

  const titles = shuffledTitles(TITLES)
  const letters = new Map<string, number>()
  const checkpoints: Checkpoint[] = []
  const interval = 1000 / MESSAGES_PER_SECOND
  const started = Date.now()
  let sent = 0
  const send = async (operationName: string, payload: unknown) => {
    socket.publish(operationName, { data: payload })
    sent++
    const due = started + sent * interval - Date.now()
    if (due > 0) await new Promise((resolve) => setTimeout(resolve, due))
  }

  for (const [index, title] of titles.entries()) {
    const item = movie({ id: `movie-${index}`, title })
    // The server sends a movie again each time it saves a piece of its artwork. Only the poster
    // is selected, so the second update (the backdrop) repeats the first, as most real ones do.
    const withPoster = { ...item, images: [poster(index)] }
    await send('LibraryItemAdded', change(item))
    await send('LibraryItemUpdated', change(withPoster))
    await send('LibraryItemUpdated', change(withPoster))
    const letter = title[0]
    letters.set(letter, (letters.get(letter) ?? 0) + 1)
    const loaded = index + 1
    if (loaded === PROFILE_FROM) await profiler?.send('Profiler.start')
    if (loaded === PROFILE_FROM + 100 && profiler) {
      const { profile } = await profiler.send('Profiler.stop')
      mkdirSync('test-results/replay', { recursive: true })
      writeFileSync('test-results/replay/profile.cpuprofile', JSON.stringify(profile))
    }
    if (loaded % COUNTS_EVERY === 0 || loaded === titles.length) {
      await send('LibraryCountsChanged', counts(loaded, letters))
    }
    if (loaded % CHECKPOINT === 0 || loaded === titles.length) {
      checkpoints.push(await checkpoint(page, { loaded, sentAt: Date.now() - started, heap }))
    }
  }

  const publishedAt = Date.now()
  await expect(
    page.getByRole('button', { name: `All ${titles.length.toLocaleString('en-US')}`, exact: true }),
  ).toBeVisible({
    timeout: 20 * 60_000,
  })
  const drainSeconds = (Date.now() - publishedAt) / 1000
  const report = {
    browser: browserName,
    titles: titles.length,
    messages: sent,
    messagesPerSecond: MESSAGES_PER_SECOND,
    publishSeconds: Math.round((publishedAt - started) / 100) / 10,
    drainSeconds: Math.round(drainSeconds * 10) / 10,
    checkpoints,
    heapAfterDrainMB: await heap(),
  }
  console.log(JSON.stringify(report, null, 2))
  mkdirSync('test-results/replay', { recursive: true })
  writeFileSync(
    `test-results/replay/library-scan-${browserName}-${titles.length}.json`,
    JSON.stringify(report, null, 2),
  )
})

// Pages a library already scanned, a screen at a time from its first title to its last, as a
// viewer flinging the grid would. Reports what the page holds and how busy it is along the way.
test('replay scrolling a large library from its first title to its last', async ({
  page,
  request,
  browserName,
}) => {
  const library = Array.from({ length: LIBRARY_TITLES }, (_, index) => ({
    ...movie({ id: `movie-${index}`, title: `Movie ${String(index).padStart(6, '0')}` }),
    images: [poster(index)],
  }))
  await openReplay({ page, request, libraryPage: (variables) => libraryPage(library, variables) })
  await page.goto(`/library/${LIBRARY}?by=TITLE&direction=ASC`)
  await expect(page.getByText(library[0].title, { exact: true })).toBeVisible()
  const heap = await heapReader(page, browserName)
  const grid = page.locator('[class*="_grid_"]')
  const checkpoints: Checkpoint[] = []
  const started = Date.now()
  let next = SCROLL_CHECKPOINT
  let position = 0
  while (position < library.length - 1) {
    const topTitle = await grid.evaluate((element) => {
      element.scrollTop += element.clientHeight
      const gridTop = element.getBoundingClientRect().top
      const titles = [...element.querySelectorAll<HTMLElement>('[class*="_posterTitle_"]')]
      return titles.findLast((title) => title.getBoundingClientRect().top >= gridTop)?.textContent
    })
    position = Math.max(position, Number(topTitle?.slice('Movie '.length) ?? 0))
    if (position >= next) {
      checkpoints.push(
        await checkpoint(page, { loaded: position, sentAt: Date.now() - started, heap }),
      )
      next += SCROLL_CHECKPOINT
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const report = {
    browser: browserName,
    titles: library.length,
    scrollSeconds: Math.round((Date.now() - started) / 100) / 10,
    checkpoints,
    heapAtEndMB: await heap(),
  }
  console.log(JSON.stringify(report, null, 2))
  mkdirSync('test-results/replay', { recursive: true })
  writeFileSync(
    `test-results/replay/library-scroll-${browserName}-${library.length}.json`,
    JSON.stringify(report, null, 2),
  )
})

async function openReplay({
  page,
  request,
  libraryPage,
}: {
  page: Page
  request: APIRequestContext
  libraryPage: (variables: LibraryPageQueryVariables) => unknown
}) {
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  const socket = await routeGraphqlSocket(page)
  await page.route('**/graphql', async (route) => {
    const { operationName, variables } = route.request().postDataJSON() as {
      operationName: string
      variables: LibraryPageQueryVariables
    }
    const reply = (data: unknown) => route.fulfill({ json: { data } })
    if (operationName === 'Me') return reply({ me })
    if (operationName === 'Libraries') return reply({ libraries: [] })
    if (operationName === 'Home')
      return reply({ continueWatching: watchingConnection([]), libraries: [] })
    if (operationName === 'LibraryPage') return reply(libraryPage(variables))
    return route.continue()
  })
  await page.addInitScript(observeTheMainThread)
  // Overrides Apollo's cache limits, e.g. REPLAY_APOLLO_CACHE_SIZES='{"inMemoryCache.executeSubSelectedArray":100}'
  if (process.env.REPLAY_APOLLO_CACHE_SIZES)
    await page.addInitScript((sizes) => {
      Object.assign(globalThis, { [Symbol.for('apollo.cacheSize')]: JSON.parse(sizes) as unknown })
    }, process.env.REPLAY_APOLLO_CACHE_SIZES)
  return socket
}

type Checkpoint = {
  loaded: number
  sentAt: number
  busyMs: number
  maxStallMs: number
  stallsOver100: number
  heapMB: number | null
  apolloCaches: unknown
}

// Main-thread time is counted from a timer's lateness, which works in every engine.
function observeTheMainThread() {
  const stats = { busyMs: 0, maxStallMs: 0, stallsOver100: 0 }
  Object.assign(window, { __mainThread: stats })
  let expected = performance.now() + 50
  setInterval(() => {
    const now = performance.now()
    const late = now - expected
    if (late > 0) stats.busyMs += late
    stats.maxStallMs = Math.max(stats.maxStallMs, late)
    if (late > 100) stats.stallsOver100++
    expected = now + 50
  }, 50)
}

async function checkpoint(
  page: Page,
  { loaded, sentAt, heap }: { loaded: number; sentAt: number; heap: () => Promise<number | null> },
): Promise<Checkpoint> {
  const stats = await page.evaluate(() => {
    const { __mainThread } = window as unknown as {
      __mainThread: { busyMs: number; maxStallMs: number; stallsOver100: number }
    }
    const snapshot = { ...__mainThread }
    Object.assign(__mainThread, { busyMs: 0, maxStallMs: 0, stallsOver100: 0 })
    return snapshot
  })
  return {
    loaded,
    sentAt,
    busyMs: Math.round(stats.busyMs),
    maxStallMs: Math.round(stats.maxStallMs),
    stallsOver100: stats.stallsOver100,
    heapMB: await heap(),
    // Apollo's internal cache sizes; only dev builds expose the client.
    apolloCaches: await page.evaluate(() => {
      const { __APOLLO_CLIENT__ } = window as unknown as {
        __APOLLO_CLIENT__?: { getMemoryInternals?: () => unknown }
      }
      return __APOLLO_CLIENT__?.getMemoryInternals?.()
    }),
  }
}

// Only Chromium exposes the heap; the reading follows a full collection, so it is what is kept.
async function heapReader(page: Page, browserName: string) {
  if (browserName !== 'chromium') return () => Promise.resolve(null)
  const session = await page.context().newCDPSession(page)
  return async () => {
    await session.send('HeapProfiler.collectGarbage')
    const { usedSize } = await session.send('Runtime.getHeapUsage')
    return Math.round(usedSize / 1048576)
  }
}

// Pages a library in title order by cursor, in either direction, as the server does.
function libraryPage(
  library: ReadonlyArray<{ id: string; title: string }>,
  variables: LibraryPageQueryVariables,
) {
  let start = 0
  if (variables.after) start = Number(variables.after) + 1
  if (variables.before) start = Math.max(0, Number(variables.before) - (variables.last ?? 0))
  const end = variables.before
    ? Number(variables.before)
    : Math.min(library.length, start + (variables.first ?? 0))
  const nodes = library.slice(start, end)
  return {
    library: {
      ...emptyLibrary().library,
      itemCount: library.length,
      alphabetIndex: [{ letter: 'M', count: library.length }],
      items: {
        edges: nodes.map((node, index) => mediaEdge({ cursor: String(start + index), node })),
        pageInfo: {
          hasNextPage: end < library.length,
          hasPreviousPage: start > 0,
          startCursor: nodes.length > 0 ? String(start) : null,
          endCursor: nodes.length > 0 ? String(end - 1) : null,
        },
      },
    },
  }
}

function emptyLibrary(): LibraryPageQuery {
  return {
    library: {
      ...{ __typename: 'Library' as const },
      id: LIBRARY,
      name: 'Movies',
      status: 'HEALTHY',
      scanCompletedOn: null,
      itemCount: 0,
      alphabetIndex: [],
      items: {
        edges: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
      },
    },
  }
}

function change(item: { id: string; title: string }) {
  return {
    change: {
      __typename: 'LibraryItemChange',
      libraryId: LIBRARY,
      itemId: item.id,
      kind: 'MOVIE',
      item,
      edge: mediaEdge({ cursor: `cursor-${item.id}`, node: item }),
    },
  }
}

function counts(itemCount: number, letters: Map<string, number>) {
  return {
    change: {
      __typename: 'Library',
      id: LIBRARY,
      itemCount,
      alphabetIndex: [...letters]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([letter, count]) => ({ letter, count })),
    },
  }
}

function poster(index: number) {
  const variant = (size: string, width: number) => ({
    __typename: 'ImageVariant',
    id: `poster-${index}-${size}`,
    size,
    width,
    height: Math.round(width * 1.5),
    url: `/api/images/poster-${index}-${size}`,
  })
  return {
    __typename: 'Image',
    aspectRatio: 0.6667,
    blurHash: 'LPE2kAoLROae~VazR+bHX8t6R+t7',
    variants: [
      variant('SMALL', 185),
      variant('MEDIUM', 342),
      variant('LARGE', 500),
      variant('ORIGINAL', 1800),
    ],
  }
}

// A scan adds titles in no particular order of title; a fixed seed keeps runs comparable.
function shuffledTitles(count: number) {
  const titles = Array.from({ length: count }, (_, index) => {
    const letter = String.fromCharCode(65 + (index % 26))
    return `${letter} Movie ${String(index).padStart(4, '0')}`
  })
  let seed = 42
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (let index = titles.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1))
    ;[titles[index], titles[other]] = [titles[other], titles[index]]
  }
  return titles
}
