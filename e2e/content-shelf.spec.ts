import { expect, test } from '@playwright/test'
import { openMovie } from './movieDetail'

// Headless Chromium hides every scrollbar unless told otherwise, and only a drawn one takes height.
test.use({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
})

test('the cast shelf scrolls by its arrows without a scrollbar under the cards', async ({
  page,
  request,
}) => {
  const crowd = Array.from({ length: 20 }, (_, index) => ({
    id: `p${index}`,
    name: `Actor ${index}`,
    images: [],
  }))
  await openMovie(page, request, { cast: crowd })

  const track = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Cast', exact: true }) })
    .getByTestId('shelf-track')
  const layout = await track.evaluate((node: HTMLElement) => ({
    scrollbarHeight: node.offsetHeight - node.clientHeight,
    overflows: node.scrollWidth > node.clientWidth,
  }))
  expect(layout).toEqual({ scrollbarHeight: 0, overflows: true })
})
