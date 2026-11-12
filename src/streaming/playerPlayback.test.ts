import { HttpResponse, graphql } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClientCapabilityDeclarationInput,
  CreatePlaybackSessionMutation,
  PlaybackSessionFieldsFragment,
} from '../graphql/generated/graphql'
import { createApolloClient } from '../graphql/client'
import { hls, resetFakeHls } from '../test/fakeHls'
import { MINIMAL_DECLARATION } from '../test/playbackCapabilities'
import { destroyedPlaybackSession, readyPlaybackSession } from '../test/playbackSession'
import { server } from '../test/server'
import type { DynamicRangeChoice } from './hlsVideoPreference'
import { type PlayerPlayback, startPlayerPlayback } from './playerPlayback'

vi.mock('hls.js', async () => (await import('../test/fakeHls')).hlsModule)

const STREAM_URL = '/api/stream/pq/multivariant.m3u8?t=playback-token'
const PQ_SESSION = {
  id: 'sess-pq',
  streamUrl: STREAM_URL,
  transcodeMode: 'REMUX',
  videoRange: 'PQ',
} as const

const [SDR_ENTRY] = MINIMAL_DECLARATION.video

// A browser on an HDR display: H.264 in SDR, and HEVC Main 10 on a PQ base.
const PQ_DECLARATION: ClientCapabilityDeclarationInput = {
  ...MINIMAL_DECLARATION,
  video: [
    SDR_ENTRY,
    {
      ...SDR_ENTRY,
      codecFamily: 'HEVC',
      codecProfiles: [{ profile: 'HEVC_MAIN_10', maxLevel: 51, maxTier: 'MAIN' }],
      maxBitDepth: 10,
      compatibleBases: ['PQ'],
    },
  ],
}

const PREFERRING_PQ = { preferHDR: true, allowedVideoRanges: ['SDR', 'PQ'] }
const SDR_ONLY = { preferHDR: false, allowedVideoRanges: ['SDR'] }

function created(playbackSession: PlaybackSessionFieldsFragment): {
  data: CreatePlaybackSessionMutation
} {
  return { data: { createPlaybackSession: { playbackSession, userErrors: [] } } }
}

// jsdom's media element has no timeline and cannot load or play. Own currentTime, readyState and
// paused let a test move the playhead, load the stream and press play; load() rewinds the element
// as a browser does when hls.js releases it.
function fakeMedia(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'currentTime', { writable: true, value: 0 })
  Object.defineProperty(video, 'paused', { writable: true, value: true })
  Object.defineProperty(video, 'readyState', { writable: true, value: 0 })
  Object.defineProperty(video, 'play', {
    value: () => {
      setPaused(video, false)
      return Promise.resolve()
    },
  })
  Object.defineProperty(video, 'pause', { value: () => setPaused(video, true) })
  Object.defineProperty(video, 'load', {
    value: () => {
      Object.assign(video, { currentTime: 0, readyState: HTMLMediaElement.HAVE_NOTHING })
      setPaused(video, true)
    },
  })
  return video
}

function setPaused(video: HTMLVideoElement, paused: boolean) {
  if (video.paused === paused) return
  Object.assign(video, { paused })
  video.dispatchEvent(new Event(paused ? 'pause' : 'play'))
}

function loadMetadata(video: HTMLVideoElement) {
  Object.assign(video, { readyState: HTMLMediaElement.HAVE_METADATA })
  video.dispatchEvent(new Event('loadedmetadata'))
}

function playheadAt(video: HTMLVideoElement, seconds: number) {
  Object.assign(video, { currentTime: seconds })
  video.dispatchEvent(new Event('timeupdate'))
}

// A failure hls.js gives up on, such as a network error with no response.
function raiseHlsFatalError() {
  const onError = hls.on.mock.calls.findLast(([event]) => event === 'hlsError')?.[1]
  expect(onError).toBeTypeOf('function')
  onError?.('hlsError', { fatal: true, type: 'networkError' })
}

describe('startPlayerPlayback', () => {
  let playback: PlayerPlayback | undefined
  // Each playback session the player created and each one it destroyed, so a test ends only once
  // the player has released every session.
  let sessions = { created: 0, destroyed: 0 }

  // Starts the playback of `session`, created for the declaration `declaration` the browser makes.
  function startPlaying({
    video,
    declaration = PQ_DECLARATION,
    session = Promise.resolve(created(readyPlaybackSession({ streamSession: PQ_SESSION }))),
    dynamicRange = 'HDR',
  }: {
    video: HTMLVideoElement
    declaration?: ClientCapabilityDeclarationInput
    session?: Promise<{ data: CreatePlaybackSessionMutation }>
    dynamicRange?: DynamicRangeChoice
  }): PlayerPlayback {
    playback = startPlayerPlayback({
      video,
      client: createApolloClient(vi.fn()),
      declareCapabilities: () => Promise.resolve(declaration),
      createPlaybackSession: () => {
        sessions.created += 1
        return session
      },
      dynamicRange,
      onSourcePhase: vi.fn(),
      onOutputShown: vi.fn(),
      onAudioSwitchRefused: vi.fn(),
    })
    return playback
  }

  // Plays the stream from `seconds`, as hls.js does once it has loaded the stream's metadata.
  async function playingFrom(video: HTMLVideoElement, seconds: number) {
    await vi.waitFor(() => expect(hls.loadSource).toHaveBeenCalledOnce())
    loadMetadata(video)
    playheadAt(video, seconds)
    await vi.waitFor(() => expect(video.paused).toBe(false))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakeHls()
    server.use(
      graphql.mutation('ReportStreamSessionTimeline', () =>
        HttpResponse.json({ data: { reportStreamSessionTimeline: true } }),
      ),
      graphql.mutation('DestroyPlaybackSession', ({ variables }) => {
        sessions.destroyed += 1
        return HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        })
      }),
    )
    sessions = { created: 0, destroyed: 0 }
  })

  afterEach(async () => {
    playback?.stop()
    playback = undefined
    await vi.waitFor(() => expect(sessions.destroyed).toBe(sessions.created))
  })

  describe('videoPreference', () => {
    it('shouldStartHlsJsPreferringTheDeclaredHdrRangesWhenTheViewerHasNotChosen', async () => {
      startPlaying({ video: fakeMedia() })

      await vi.waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))
      expect(hls.config?.videoPreference).toEqual(PREFERRING_PQ)
    })

    it('shouldStartHlsJsOnSdrOnlyWhenTheDeclarationListsNoHdrRange', async () => {
      startPlaying({ video: fakeMedia(), declaration: MINIMAL_DECLARATION })

      await vi.waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))
      expect(hls.config?.videoPreference).toEqual(SDR_ONLY)
    })
  })

  describe('dynamicRange', () => {
    it('shouldStartHlsJsOnSdrOnlyWhenTheViewerChoseSdr', async () => {
      startPlaying({ video: fakeMedia(), dynamicRange: 'SDR' })

      await vi.waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))
      expect(hls.config?.videoPreference).toEqual(SDR_ONLY)
    })

    it('shouldKeepTheChoiceWhenThePageReturnsFromTheBackForwardCache', async () => {
      const video = fakeMedia()
      startPlaying({ video, dynamicRange: 'SDR' })
      await playingFrom(video, 120)

      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))

      await vi.waitFor(() => expect(hls.loadSource).toHaveBeenCalledTimes(2))
      expect(hls.config?.videoPreference).toEqual(SDR_ONLY)
    })
  })

  describe('resumePoint', () => {
    it('shouldStayWhereTheViewerWasPlayingWhenTheFailedStreamIsReleased', async () => {
      const video = fakeMedia()
      // Releasing the stream rewinds and pauses the element, as a browser does.
      hls.destroy.mockImplementationOnce(() => video.load())
      const playback = startPlaying({ video })
      await playingFrom(video, 120)

      raiseHlsFatalError()

      expect(video).toMatchObject({ currentTime: 0, paused: true })
      expect(playback.resumePoint()).toEqual({ position: 120, playing: true })
    })
  })
})
