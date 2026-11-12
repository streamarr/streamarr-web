import type { DecodingAnswers } from './decodingAnswers'
import type { askVideoQuestions, browserPlaybackPlatform } from './playbackCapabilities'

/** What the questions after load use from the capabilities module. */
export interface CapabilitiesModule {
  askVideoQuestions: typeof askVideoQuestions
  browserPlaybackPlatform: typeof browserPlaybackPlatform
}

/** The window, as far as the questions after load read it. */
export interface LoadingPage {
  readonly document: {
    readonly readyState: DocumentReadyState
    createElement: (tagName: 'video') => HTMLVideoElement
  }
  addEventListener: (type: 'load', listener: () => void, options: { once: true }) => void
}

/**
 * Where the page keeps decoding answers, asks the video questions of a capability declaration once
 * the page has loaded, so that the first playback session finds them answered. Calls
 * `loadCapabilities` only then, because the capabilities module imports hls.js. Settles once the
 * questions settle, and never rejects: after a failure, each playback session asks for itself.
 */
export async function askVideoQuestionsAfterLoad({
  pageAnswers,
  page,
  loadCapabilities,
}: {
  pageAnswers: DecodingAnswers | undefined
  page: LoadingPage
  loadCapabilities: () => Promise<CapabilitiesModule>
}): Promise<void> {
  if (!pageAnswers) {
    return
  }
  await loaded(page)
  try {
    const capabilities = await loadCapabilities()
    const video = page.document.createElement('video')
    await capabilities.askVideoQuestions(capabilities.browserPlaybackPlatform(video, pageAnswers))
  } catch {
    // Each playback session asks the questions that remain.
  }
}

function loaded(page: LoadingPage): Promise<void> {
  if (page.document.readyState === 'complete') {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    page.addEventListener('load', () => resolve(), { once: true })
  })
}
