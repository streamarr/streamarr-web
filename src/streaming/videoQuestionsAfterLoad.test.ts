import { CatchBoundary, lazyRouteComponent } from '@tanstack/react-router'
import { act, render } from '@testing-library/react'
import { createElement, Suspense } from 'react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { playbackPlatformFixture } from '../test/playbackCapabilities'
import { createDecodingAnswers, type DecodingAnswers } from './decodingAnswers'
import type { askVideoQuestions, browserPlaybackPlatform } from './playbackCapabilities'
import { askVideoQuestionsAfterLoad, type LoadingPage } from './videoQuestionsAfterLoad'

function sessionStorageHolding(...keys: string[]): LoadingPage['sessionStorage'] {
  const entries = new Map(keys.map((key) => [key, '1']))
  return {
    get length() {
      return entries.size
    },
    key: (index) => [...entries.keys()][index] ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
    removeItem: (key) => {
      entries.delete(key)
    },
  }
}

// A window whose document reports `readyState`, and that fires load only when the test dispatches it.
function pageWhoseDocumentIs(
  readyState: DocumentReadyState,
  { sessionStorage = sessionStorageHolding() }: Partial<Pick<LoadingPage, 'sessionStorage'>> = {},
) {
  return Object.assign(new EventTarget(), {
    document: {
      readyState,
      createElement: (tagName: 'video') => document.createElement(tagName),
    },
    sessionStorage,
  })
}

function fakeCapabilitiesModule() {
  const platform = playbackPlatformFixture()
  const bindPlatform = vi.fn<typeof browserPlaybackPlatform>(() => platform)
  const askVideo = vi.fn<typeof askVideoQuestions>(() => Promise.resolve())
  const loadCapabilities = vi.fn(() =>
    Promise.resolve({ browserPlaybackPlatform: bindPlatform, askVideoQuestions: askVideo }),
  )
  return { platform, bindPlatform, askVideo, loadCapabilities }
}

function keptAnswers(): DecodingAnswers {
  return createDecodingAnswers({ decodingInfo: vi.fn() })
}

// Lets the installed router mark the tab: one of its lazy route components fails to import with
// `message`. Returns the entry that the router wrote to the window's sessionStorage.
async function markTheTabWithTheRouter(message: string): Promise<{ key: string; value: string }> {
  onTestFinished(() => window.sessionStorage.clear())
  const keysBefore = Object.keys(window.sessionStorage)
  const Playback = lazyRouteComponent(() =>
    Promise.reject<{ default: () => null }>(new TypeError(message)),
  )
  // React renders Playback again after the router marks the tab, and the router then throws the
  // import error, so a boundary must catch it.
  await act(async () => {
    render(
      createElement(CatchBoundary, {
        getResetKey: () => 0,
        errorComponent: () => null,
        children: createElement(Suspense, { fallback: null }, createElement(Playback)),
      }),
      { onCaughtError: () => {} },
    )
  })
  const key = Object.keys(window.sessionStorage).find((kept) => !keysBefore.includes(kept))
  const value = key === undefined ? null : window.sessionStorage.getItem(key)
  if (key === undefined || value === null) {
    throw new Error('The router wrote no mark to sessionStorage')
  }
  return { key, value }
}

// Long enough for any promise that the function chains to settle, under fake timers.
async function letEverythingSettle() {
  await vi.advanceTimersByTimeAsync(60_000)
}

describe('askVideoQuestionsAfterLoad', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldAskTheVideoQuestionsThroughTheKeptAnswersOnlyOnceThePageLoadsWhenTheDocumentIsStillLoading', async () => {
    const page = pageWhoseDocumentIs('interactive')
    const capabilities = fakeCapabilitiesModule()
    const pageAnswers = keptAnswers()

    const asking = askVideoQuestionsAfterLoad({
      pageAnswers,
      page,
      loadCapabilities: capabilities.loadCapabilities,
    })
    await letEverythingSettle()
    expect(capabilities.loadCapabilities).not.toHaveBeenCalled()
    page.dispatchEvent(new Event('load'))
    await asking

    expect(capabilities.bindPlatform).toHaveBeenCalledWith(
      expect.any(HTMLVideoElement),
      pageAnswers,
    )
    expect(capabilities.askVideo).toHaveBeenCalledWith(capabilities.platform)
  })

  it('shouldAskTheVideoQuestionsAtOnceWhenTheDocumentHasAlreadyLoaded', async () => {
    const capabilities = fakeCapabilitiesModule()

    await askVideoQuestionsAfterLoad({
      pageAnswers: keptAnswers(),
      page: pageWhoseDocumentIs('complete'),
      loadCapabilities: capabilities.loadCapabilities,
    })

    expect(capabilities.askVideo).toHaveBeenCalledWith(capabilities.platform)
  })

  it('shouldAskTheVideoQuestionsOnceWhenThePageFiresLoadTwice', async () => {
    const page = pageWhoseDocumentIs('loading')
    const capabilities = fakeCapabilitiesModule()
    const asking = askVideoQuestionsAfterLoad({
      pageAnswers: keptAnswers(),
      page,
      loadCapabilities: capabilities.loadCapabilities,
    })

    page.dispatchEvent(new Event('load'))
    page.dispatchEvent(new Event('load'))
    await asking
    await letEverythingSettle()

    expect(capabilities.loadCapabilities).toHaveBeenCalledOnce()
    expect(capabilities.askVideo).toHaveBeenCalledOnce()
  })

  it.each(['loading', 'complete'] as const)(
    'shouldNeitherLoadTheCapabilitiesNorAskWhenThePageKeepsNoAnswersAndTheDocumentIs%s',
    async (readyState) => {
      const page = pageWhoseDocumentIs(readyState)
      const capabilities = fakeCapabilitiesModule()

      await askVideoQuestionsAfterLoad({
        pageAnswers: undefined,
        page,
        loadCapabilities: capabilities.loadCapabilities,
      })
      page.dispatchEvent(new Event('load'))
      await letEverythingSettle()

      expect(capabilities.loadCapabilities).not.toHaveBeenCalled()
    },
  )

  it('shouldSettleWithoutARejectionWhenTheCapabilitiesModuleFailsToLoad', async () => {
    const loadCapabilities = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    )

    const asking = askVideoQuestionsAfterLoad({
      pageAnswers: keptAnswers(),
      page: pageWhoseDocumentIs('complete'),
      loadCapabilities,
    })

    await expect(asking).resolves.toBeUndefined()
    expect(loadCapabilities).toHaveBeenCalledOnce()
  })

  it.each([
    ['WebKit', 'Importing a module script failed.'],
    ['Chromium', 'Failed to fetch dynamically imported module: http://localhost/assets/play.js'],
  ])(
    'shouldNotLoadTheCapabilitiesWhenTheRouterHasMarkedTheTabAfterAFailedImportWithTheMessageOf%s',
    async (_engine, message) => {
      window.sessionStorage.setItem('tsr-scroll-restoration-v1_3', '{}')
      await markTheTabWithTheRouter(message)
      expect(window.sessionStorage).toHaveLength(2)
      const capabilities = fakeCapabilitiesModule()

      await askVideoQuestionsAfterLoad({
        pageAnswers: keptAnswers(),
        page: pageWhoseDocumentIs('complete', { sessionStorage: window.sessionStorage }),
        loadCapabilities: capabilities.loadCapabilities,
      })

      expect(capabilities.loadCapabilities).not.toHaveBeenCalled()
    },
  )

  it('shouldSettleWithoutLoadingTheCapabilitiesWhenReadingTheSessionStorageThrows', async () => {
    const page = Object.defineProperty(pageWhoseDocumentIs('complete'), 'sessionStorage', {
      get: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    const capabilities = fakeCapabilitiesModule()

    const asking = askVideoQuestionsAfterLoad({
      pageAnswers: keptAnswers(),
      page,
      loadCapabilities: capabilities.loadCapabilities,
    })

    await expect(asking).resolves.toBeUndefined()
    expect(capabilities.loadCapabilities).not.toHaveBeenCalled()
  })

  it('shouldNotLoadTheCapabilitiesWhenTheSessionStorageHasRoomForLessThanTheRoutersMark', async () => {
    const mark = await markTheTabWithTheRouter('Importing a module script failed.')
    const markSize = mark.key.length + mark.value.length
    const sessionStorage: LoadingPage['sessionStorage'] = {
      length: 0,
      key: () => null,
      setItem: (key, value) => {
        if (key.length + value.length >= markSize) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        }
      },
      removeItem: () => {},
    }
    const capabilities = fakeCapabilitiesModule()

    const asking = askVideoQuestionsAfterLoad({
      pageAnswers: keptAnswers(),
      page: pageWhoseDocumentIs('complete', { sessionStorage }),
      loadCapabilities: capabilities.loadCapabilities,
    })

    await expect(asking).resolves.toBeUndefined()
    expect(capabilities.loadCapabilities).not.toHaveBeenCalled()
  })

  it('shouldLeaveTheSessionStorageAsItWasWhenThePageAsksTheVideoQuestions', async () => {
    const sessionStorage = sessionStorageHolding('tsr-scroll-restoration-v1_3')
    const capabilities = fakeCapabilitiesModule()

    await askVideoQuestionsAfterLoad({
      pageAnswers: keptAnswers(),
      page: pageWhoseDocumentIs('complete', { sessionStorage }),
      loadCapabilities: capabilities.loadCapabilities,
    })

    expect(capabilities.askVideo).toHaveBeenCalledOnce()
    expect(sessionStorage.length).toBe(1)
    expect(sessionStorage.key(0)).toBe('tsr-scroll-restoration-v1_3')
  })

  it('shouldAskTheVideoQuestionsWhenTheSessionStorageHoldsOnlyOtherKeys', async () => {
    const capabilities = fakeCapabilitiesModule()

    await askVideoQuestionsAfterLoad({
      pageAnswers: keptAnswers(),
      page: pageWhoseDocumentIs('complete', {
        sessionStorage: sessionStorageHolding('tsr-scroll-restoration-v1_3'),
      }),
      loadCapabilities: capabilities.loadCapabilities,
    })

    expect(capabilities.askVideo).toHaveBeenCalledWith(capabilities.platform)
  })

  it('shouldSettleWithoutARejectionWhenAskingTheVideoQuestionsFails', async () => {
    const capabilities = fakeCapabilitiesModule()
    capabilities.askVideo.mockRejectedValue(new TypeError('Unsupported configuration'))

    const asking = askVideoQuestionsAfterLoad({
      pageAnswers: keptAnswers(),
      page: pageWhoseDocumentIs('complete'),
      loadCapabilities: capabilities.loadCapabilities,
    })

    await expect(asking).resolves.toBeUndefined()
    expect(capabilities.askVideo).toHaveBeenCalledOnce()
  })
})
