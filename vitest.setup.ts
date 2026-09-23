import '@testing-library/jest-dom/vitest'
import { MotionGlobalConfig } from 'motion'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { server } from './src/test/server'

// Motion completes every animation at once, so choreography that waits on one settles in a test.
MotionGlobalConfig.skipAnimations = true

// jsdom has no matchMedia; Mantine's color-scheme provider needs it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
})

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// jsdom has no scroll layout, so it implements neither this nor a meaningful scroll position;
// tests that care about scrolling assert against the mocked IntersectionObserver instead.
// eslint-disable-next-line @typescript-eslint/unbound-method -- a polyfill check reads the method without calling it
Element.prototype.scrollIntoView ??= function scrollIntoView() {}

// Mantine's SegmentedControl positions its indicator with ResizeObserver, which jsdom lacks.
class QuietResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= QuietResizeObserver as unknown as typeof ResizeObserver

// jsdom has no IntersectionObserver either. Unlike ResizeObserver this one isn't fire-and-forget:
// infinite-scroll and alphabet-rail tests need to trigger it manually, so each instance is kept
// reachable via `intersectionObserverInstances` instead of being a no-op stub.
export class MockIntersectionObserver implements IntersectionObserver {
  root: Element | Document | null
  rootMargin: string
  scrollMargin = ''
  thresholds: ReadonlyArray<number>
  readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.root = (options?.root as Element | Document | null) ?? null
    this.rootMargin = options?.rootMargin ?? ''
    this.thresholds = ([] as number[]).concat(options?.threshold ?? [])
    intersectionObserverInstances.push(this)
  }

  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = (): IntersectionObserverEntry[] => []
}
export const intersectionObserverInstances: MockIntersectionObserver[] = []
globalThis.IntersectionObserver ??=
  MockIntersectionObserver as unknown as typeof IntersectionObserver

afterEach(() => {
  intersectionObserverInstances.length = 0
})
