import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playbackPlatformFixture } from '../test/playbackCapabilities'
import { createDecodingAnswers, type DecodingAnswers } from './decodingAnswers'
import type { askVideoQuestions, browserPlaybackPlatform } from './playbackCapabilities'
import { askVideoQuestionsAfterLoad } from './videoQuestionsAfterLoad'

// A window whose document reports `readyState`, and that fires load only when the test dispatches it.
function pageWhoseDocumentIs(readyState: DocumentReadyState) {
  return Object.assign(new EventTarget(), {
    document: {
      readyState,
      createElement: (tagName: 'video') => document.createElement(tagName),
    },
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
