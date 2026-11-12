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
  readonly sessionStorage: Pick<Storage, 'length' | 'key' | 'setItem' | 'removeItem'>
  addEventListener: (type: 'load', listener: () => void, options: { once: true }) => void
}

const ROUTER_RELOAD_KEY_PREFIX = 'tanstack_router_reload:'
// An entry at least as large as the mark that the router writes for Safari's failed import.
const WRITE_PROBE_KEY = 'streamarr_reload_probe'
const WRITE_PROBE_VALUE = `${ROUTER_RELOAD_KEY_PREFIX}Importing a module script failed.`

/**
 * Where the page keeps decoding answers, asks the video questions of a capability declaration once
 * the page has loaded, so that the first playback session finds them answered. Calls
 * `loadCapabilities` only then, because the capabilities module imports hls.js. Asks nothing once
 * the router has reloaded the tab after a failed import, or when sessionStorage cannot be read and
 * written. Settles once the questions settle, and never rejects: after a failure, each playback
 * session asks for itself.
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
  // Safari remembers an error response to a module request until the page reloads, so a failed
  // import here also fails the play route's import. Only a reload recovers. The router reloads once
  // in a tab, and marks sessionStorage before it does. Where sessionStorage cannot be read or
  // refuses the mark, the router cannot reload at all.
  if (!routerCanStillReload(page)) {
    return
  }
  try {
    const capabilities = await loadCapabilities()
    const video = page.document.createElement('video')
    await capabilities.askVideoQuestions(capabilities.browserPlaybackPlatform(video, pageAnswers))
  } catch {
    // Each playback session asks the questions that remain.
  }
}

function routerCanStillReload(page: LoadingPage): boolean {
  try {
    const storage = page.sessionStorage
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    if (keys.some((key) => key?.startsWith(ROUTER_RELOAD_KEY_PREFIX))) {
      return false
    }
    storage.setItem(WRITE_PROBE_KEY, WRITE_PROBE_VALUE)
    storage.removeItem(WRITE_PROBE_KEY)
    return true
  } catch {
    return false
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
