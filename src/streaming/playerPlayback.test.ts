import { HttpResponse, graphql } from 'msw'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  ClientCapabilityDeclarationInput,
  CreatePlaybackSessionMutation,
  PlaybackSessionFieldsFragment,
} from '../graphql/generated/graphql'
import { createApolloClient } from '../graphql/client'
import { hls, resetFakeHls } from '../test/fakeHls'
import { MINIMAL_DECLARATION } from '../test/playbackCapabilities'
import {
  destroyedPlaybackSession,
  readyDirectPlaySession,
  readyPlaybackSession,
} from '../test/playbackSession'
import { server } from '../test/server'
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
      codecProfiles: [{ profile: 'HEVC_MAIN_10', maxLevel: 51 }],
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

// The server answers a segment request with 503 while a stream session is being replaced, which
// sends the player to read the playback status.
function answerTheNextSegmentWith503({ fatal }: { fatal: boolean }) {
  const onError = hls.on.mock.calls.findLast(([event]) => event === 'hlsError')?.[1]
  onError?.('hlsError', { fatal, type: 'networkError', response: { code: 503 } })
}

// Holds every playback status read until the test ends, and counts them.
function holdStatusReads(): { count: number } {
  const reads = { count: 0 }
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  onTestFinished(() => release())
  server.use(
    graphql.query('PlaybackSession', async () => {
      reads.count += 1
      await released
      return HttpResponse.json({ data: { playbackSession: null } })
    }),
  )
  return reads
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
  }: {
    video: HTMLVideoElement
    declaration?: ClientCapabilityDeclarationInput
    session?: Promise<{ data: CreatePlaybackSessionMutation }>
  }): PlayerPlayback {
    playback = startPlayerPlayback({
      video,
      client: createApolloClient(vi.fn()),
      declareCapabilities: () => Promise.resolve(declaration),
      createPlaybackSession: () => {
        sessions.created += 1
        return session
      },
      onSourcePhase: vi.fn(),
      onOutputShown: vi.fn(),
      onNotice: vi.fn(),
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

  describe('chooseDynamicRange', () => {
    it('shouldAttachTheStreamAgainAtThePlayheadPreferringSdrWhenTheViewerChoosesSdr', async () => {
      const video = fakeMedia()
      const playing = startPlaying({ video })
      await playingFrom(video, 120)
      // Like hls.js, which releases the element as it is destroyed.
      hls.destroy.mockImplementationOnce(() => video.load())

      playing.chooseDynamicRange('SDR')
      loadMetadata(video)

      expect(hls.loadSource.mock.calls).toEqual([[STREAM_URL], [STREAM_URL]])
      expect(hls.config?.videoPreference).toEqual(SDR_ONLY)
      expect(video.currentTime).toBe(120)
      expect(video.paused).toBe(false)
    })

    it('shouldPreferTheDeclaredHdrRangesAgainWhenTheViewerChoosesHdrAfterSdr', async () => {
      const video = fakeMedia()
      const playing = startPlaying({ video })
      await playingFrom(video, 120)

      playing.chooseDynamicRange('SDR')
      playing.chooseDynamicRange('HDR')

      expect(hls.loadSource).toHaveBeenCalledTimes(3)
      expect(hls.config?.videoPreference).toEqual(PREFERRING_PQ)
    })

    it('shouldKeepTheAttachedStreamWhenTheViewerChoosesTheRangeItPrefers', async () => {
      const video = fakeMedia()
      const playing = startPlaying({ video })
      await playingFrom(video, 120)

      playing.chooseDynamicRange('HDR')

      expect(hls.loadSource).toHaveBeenCalledOnce()
    })

    it('shouldStartTheStreamPreferringSdrWhenTheViewerChoseSdrBeforeItWasReady', async () => {
      let answer: (session: { data: CreatePlaybackSessionMutation }) => void = () => {}
      const session = new Promise<{ data: CreatePlaybackSessionMutation }>((resolve) => {
        answer = resolve
      })
      const playing = startPlaying({ video: fakeMedia(), session })

      playing.chooseDynamicRange('SDR')
      answer(created(readyPlaybackSession({ streamSession: PQ_SESSION })))

      await vi.waitFor(() => expect(hls.loadSource).toHaveBeenCalledOnce())
      expect(hls.config?.videoPreference).toEqual(SDR_ONLY)
    })

    it('shouldLeaveTheStreamToTheElementWhenTheBrowserPlaysHlsWithoutHlsJs', async () => {
      hls.supported = false
      const video = fakeMedia()
      const playing = startPlaying({ video })
      await vi.waitFor(() => expect(video.getAttribute('src')).toBe(STREAM_URL))
      loadMetadata(video)
      playheadAt(video, 120)

      playing.chooseDynamicRange('SDR')

      expect(video.getAttribute('src')).toBe(STREAM_URL)
      expect(video.currentTime).toBe(120)
    })

    it('shouldLeaveADirectPlayedFileToTheElementWhenTheViewerChoosesSdr', async () => {
      const fileUrl = '/api/stream/file/source.mp4?t=playback-token'
      const video = fakeMedia()
      const playing = startPlaying({
        video,
        session: Promise.resolve(
          created(
            readyDirectPlaySession({
              streamSession: { id: 'sess-file', streamUrl: fileUrl, videoRange: 'PQ' },
            }),
          ),
        ),
      })
      await vi.waitFor(() => expect(video.getAttribute('src')).toBe(fileUrl))
      loadMetadata(video)
      playheadAt(video, 120)

      playing.chooseDynamicRange('SDR')

      expect(video.getAttribute('src')).toBe(fileUrl)
      expect(video.currentTime).toBe(120)
    })

    it('shouldPlayTheChosenPreferenceWhenTheViewerPlaysAgainAfterTheRealEnd', async () => {
      const video = fakeMedia()
      const playing = startPlaying({
        video,
        session: Promise.resolve(
          created(readyPlaybackSession({ streamSession: { ...PQ_SESSION, mediaEndSeconds: 600 } })),
        ),
      })
      await playingFrom(video, 120)
      playheadAt(video, 600)
      expect(video.paused).toBe(true)

      playing.chooseDynamicRange('SDR')
      expect(hls.loadSource).toHaveBeenCalledOnce()
      void video.play()

      expect(hls.loadSource).toHaveBeenCalledTimes(2)
      expect(hls.config?.videoPreference).toEqual(SDR_ONLY)
    })

    it('shouldReadTheStatusForTheStreamAttachedAgainWhenItFailsWhileTheEarlierReadWaits', async () => {
      const statusReads = holdStatusReads()
      const video = fakeMedia()
      const playing = startPlaying({ video })
      await playingFrom(video, 120)
      answerTheNextSegmentWith503({ fatal: false })
      await vi.waitFor(() => expect(statusReads.count).toBe(1))

      playing.chooseDynamicRange('SDR')
      answerTheNextSegmentWith503({ fatal: true })

      await vi.waitFor(() => expect(statusReads.count).toBe(2))
    })

    it('shouldKeepTheChoiceWhenThePageReturnsFromTheBackForwardCache', async () => {
      const video = fakeMedia()
      const playing = startPlaying({ video })
      await playingFrom(video, 120)
      playing.chooseDynamicRange('SDR')

      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))

      await vi.waitFor(() => expect(hls.loadSource).toHaveBeenCalledTimes(3))
      expect(hls.config?.videoPreference).toEqual(SDR_ONLY)
    })
  })
})
