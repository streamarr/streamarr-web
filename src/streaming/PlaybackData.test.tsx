import { act, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { SharePlaybackReportInput } from '../graphql/generated/graphql'
import { deferred } from '../test/deferred'
import { CHROME_USER_AGENT } from '../test/playbackCapabilities'
import { playbackDecision, servedDecision } from '../test/playbackSession'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { PlaybackData, type PlaybackDataStream } from './PlaybackData'
import type { StreamStats } from './playerPlayback'

const PLAYBACK_SESSION_ID = 'playback-1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const STREAM_SESSION_ID = 'sess-2'
const SCREEN = {
  screen: { width: 2560, height: 1440, pixelRatio: 2 },
  displaysHighDynamicRange: true,
  userAgent: CHROME_USER_AGENT,
}

// What hls.js reports while the second of three variants plays.
const PLAYING_STATS: StreamStats = {
  variant: { height: 720, bitrate: 3_000_000, step: 2, steps: 3 },
  bandwidthEstimate: 12_500_000,
  videoCodec: 'avc1.64001f',
  audioCodec: 'mp4a.40.2',
  audioChannels: 2,
  stalls: 1,
}

// A video element that shows a 1280×720 picture, holds 8 seconds ahead and dropped 3 frames.
function playingVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  Object.defineProperty(video, 'videoWidth', { value: 1280 })
  Object.defineProperty(video, 'videoHeight', { value: 720 })
  Object.defineProperty(video, 'buffered', {
    value: { length: 1, start: () => 0, end: () => 8 },
  })
  Object.defineProperty(video, 'getVideoPlaybackQuality', {
    value: () => ({ droppedVideoFrames: 3, totalVideoFrames: 900 }),
  })
  return video
}

function serveDecision() {
  server.use(
    graphql.query('PlaybackDecisions', () =>
      HttpResponse.json({
        data: {
          playbackSession: {
            __typename: 'PlaybackSession',
            id: PLAYBACK_SESSION_ID,
            decisions: [servedDecision(playbackDecision({ streamSessionId: STREAM_SESSION_ID }))],
          },
        },
      }),
    ),
  )
}

type ShareAnswer = (input: SharePlaybackReportInput) => Response | Promise<Response>

const SHARED: ShareAnswer = () =>
  HttpResponse.json({
    data: { sharePlaybackReport: { playbackReportId: 'report-1', userErrors: [] } },
  })

// Records each shared report's input and answers it with `answer`.
function serveShare(answer: ShareAnswer = SHARED): SharePlaybackReportInput[] {
  const shared: SharePlaybackReportInput[] = []
  server.use(
    graphql.mutation('SharePlaybackReport', ({ variables }) => {
      const input = variables.input as SharePlaybackReportInput
      shared.push(input)
      return answer(input)
    }),
  )
  return shared
}

type Attached = PlaybackDataStream | null

// The panel over a player that can attach another stream, or none, as a format fallback does.
function ReplaceablePanel({
  initial,
  onReplace,
}: Readonly<{ initial: Attached; onReplace: (replace: (next: Attached) => void) => void }>) {
  const [stream, setStream] = useState(initial)
  onReplace(setStream)
  return (
    <PlaybackData
      videoRef={{ current: playingVideo() }}
      stream={stream}
      screen={SCREEN}
      controlsReach={null}
      closesOnEscape
      onClose={() => undefined}
    />
  )
}

function renderPanel({ stats = PLAYING_STATS }: { stats?: StreamStats } = {}) {
  const current = { stats }
  const stream: PlaybackDataStream = {
    playbackSessionId: PLAYBACK_SESSION_ID,
    streamSessionId: STREAM_SESSION_ID,
    videoRange: 'SDR',
    requestedChoice: 'AUTO',
    playingChoice: 'AUTO',
    sourceContainer: null,
    streamStats: () => current.stats,
  }
  let replace: (next: Attached) => void = () => undefined
  const rendered = renderWithProviders(
    <ReplaceablePanel
      initial={stream}
      onReplace={(setter) => {
        replace = setter
      }}
    />,
  )
  const panel = screen.getByRole('region', { name: 'Playback data' })
  return {
    ...rendered,
    panel,
    stream,
    // The player reports new figures, as it does while the note is written.
    reportStats: (next: StreamStats) => {
      current.stats = next
    },
    // The player attaches another stream, or none while the next one prepares.
    attach: (next: Attached) => act(() => replace(next)),
  }
}

describe('PlaybackData', () => {
  describe('sharing with the Server Admin', () => {
    it('shouldSendThePanelsFiguresFromThePressWhenTheViewerSendsWithoutANote', async () => {
      serveDecision()
      const shared = serveShare()
      const { user, panel, reportStats } = renderPanel()

      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      reportStats({ ...PLAYING_STATS, stalls: 4, bandwidthEstimate: 1_000_000 })
      await user.click(within(panel).getByRole('button', { name: 'Send' }))

      expect(await within(panel).findByText('Shared with your Server Admin.')).toBeInTheDocument()
      expect(shared).toEqual([
        {
          playbackSessionId: PLAYBACK_SESSION_ID,
          streamSessionId: STREAM_SESSION_ID,
          submissionId: expect.stringMatching(UUID) as unknown,
          player: {
            qualityStep: { number: 2, count: 3, height: 720, bitrate: 3_000_000 },
            observedBitrate: 12_500_000,
            bufferSeconds: 8,
            droppedFrames: 3,
            stalls: 1,
            resolution: { width: 1280, height: 720 },
            videoCodec: 'avc1.64001f',
            hdrMode: 'SDR',
            audio: { codec: 'mp4a.40.2', channels: 2 },
            screen: { width: 2560, height: 1440, pixelRatio: 2, hdr: true },
            browser: { name: 'Chrome', version: '141' },
          },
        },
      ])
    })

    it('shouldLeaveOutEachFigureThatThePlayerDoesNotKnowWhenTheViewerShares', async () => {
      serveDecision()
      const shared = serveShare()
      const { user, panel } = renderPanel({ stats: { stalls: 0 } })

      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      await user.click(within(panel).getByRole('button', { name: 'Send' }))

      await within(panel).findByText('Shared with your Server Admin.')
      expect(Object.keys(shared[0].player)).toEqual([
        'bufferSeconds',
        'droppedFrames',
        'stalls',
        'resolution',
        'hdrMode',
        'screen',
        'browser',
      ])
    })

    it('shouldSendTheViewersNoteWhenTheViewerWritesOne', async () => {
      serveDecision()
      const shared = serveShare()
      const { user, panel } = renderPanel()

      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      await user.type(
        within(panel).getByRole('textbox', { name: 'Add a note (optional)' }),
        'Stutters after every seek',
      )
      await user.click(within(panel).getByRole('button', { name: 'Send' }))

      await within(panel).findByText('Shared with your Server Admin.')
      expect(shared.map((input) => input.note)).toEqual(['Stutters after every seek'])
    })

    it('shouldKeepTheNoteTo280CharactersWhenTheViewerTypesMore', async () => {
      serveDecision()
      const { user, panel } = renderPanel()

      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      const note = within(panel).getByRole('textbox', { name: 'Add a note (optional)' })
      await user.click(note)
      await user.paste('a'.repeat(300))

      expect(note).toHaveValue('a'.repeat(280))
      expect(within(panel).getByText('280 of 280 characters')).toBeInTheDocument()
    })

    it('shouldSendNothingAndOfferTheButtonAgainWhenTheViewerCancels', async () => {
      serveDecision()
      const shared = serveShare()
      const { user, panel } = renderPanel()

      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      await user.type(within(panel).getByRole('textbox', { name: 'Add a note (optional)' }), 'x')
      await user.click(within(panel).getByRole('button', { name: 'Cancel' }))

      expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
      expect(
        within(panel).getByRole('button', { name: 'Share with Server Admin' }),
      ).toBeInTheDocument()
      expect(shared).toEqual([])
    })

    it('shouldKeepTheNoteAndShareTheFiguresFromThePressWhenTheStreamIsReplacedMeanwhile', async () => {
      serveDecision()
      const shared = serveShare()
      const { user, panel, stream, attach, reportStats } = renderPanel()

      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      await user.type(
        within(panel).getByRole('textbox', { name: 'Add a note (optional)' }),
        'Froze, then',
      )
      attach(null)
      reportStats({ stalls: 0 })
      attach({ ...stream, streamSessionId: 'sess-3' })
      await user.type(
        within(panel).getByRole('textbox', { name: 'Add a note (optional)' }),
        ' changed quality',
      )
      await user.click(within(panel).getByRole('button', { name: 'Send' }))

      await within(panel).findByText('Shared with your Server Admin.')
      expect(shared).toMatchObject([
        {
          streamSessionId: STREAM_SESSION_ID,
          note: 'Froze, then changed quality',
          player: { stalls: 1, qualityStep: { number: 2 } },
        },
      ])
    })

    it('shouldOfferShareOnlyOnceAStreamIsAttachedWhenThePanelOpensBeforeOne', async () => {
      const { panel, stream, attach } = renderPanel()
      serveDecision()

      attach(null)

      expect(within(panel).getByRole('button', { name: 'Share with Server Admin' })).toBeDisabled()
      attach(stream)
      expect(within(panel).getByRole('button', { name: 'Share with Server Admin' })).toBeEnabled()
    })

    it('shouldHoldTheNoteAsSentWhileTheReportIsSending', async () => {
      serveDecision()
      const answered = deferred()
      const shared = serveShare(async (input) => {
        await answered.promise
        return SHARED(input)
      })
      const { user, panel } = renderPanel()
      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      const note = within(panel).getByRole('textbox', { name: 'Add a note (optional)' })
      await user.type(note, 'Stutters')

      await user.click(within(panel).getByRole('button', { name: 'Send' }))
      await user.type(note, ' after every seek')

      expect(note).toHaveValue('Stutters')
      await act(async () => {
        answered.resolve()
        await answered.promise
      })
      await within(panel).findByText('Shared with your Server Admin.')
      expect(shared.map((input) => input.note)).toEqual(['Stutters'])
    })

    it('shouldShowTheServersMessageAndKeepTheNoteWhenTheServerRefusesTheReport', async () => {
      serveDecision()
      const shared = serveShare(() =>
        HttpResponse.json({
          data: {
            sharePlaybackReport: {
              playbackReportId: null,
              userErrors: [
                {
                  __typename: 'PlaybackSessionClosedError',
                  message: 'The playback session has ended.',
                },
              ],
            },
          },
        }),
      )
      const { user, panel } = renderPanel()

      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      const note = within(panel).getByRole('textbox', { name: 'Add a note (optional)' })
      await user.type(note, 'Green picture')
      await user.click(within(panel).getByRole('button', { name: 'Send' }))

      expect(await within(panel).findByRole('alert')).toHaveTextContent(
        'The playback session has ended.',
      )
      expect(note).toHaveValue('Green picture')
      expect(within(panel).queryByText('Shared with your Server Admin.')).not.toBeInTheDocument()
      expect(shared).toHaveLength(1)
    })

    it('shouldResendThePressesSubmissionIdAfterALostAnswerAndMakeANewOneForTheNextPress', async () => {
      serveDecision()
      const answers: ShareAnswer[] = [() => HttpResponse.error(), SHARED, SHARED]
      const shared = serveShare((input) => answers.shift()!(input))
      const { user, panel } = renderPanel()

      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      await user.click(within(panel).getByRole('button', { name: 'Send' }))
      await within(panel).findByRole('alert')
      await user.click(within(panel).getByRole('button', { name: 'Send' }))
      await within(panel).findByText('Shared with your Server Admin.')
      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      await user.click(within(panel).getByRole('button', { name: 'Send' }))
      await waitFor(() => expect(shared).toHaveLength(3))

      const [lost, resent, next] = shared.map(({ submissionId }) => submissionId)
      expect(lost).toMatch(UUID)
      expect(resent).toBe(lost)
      expect(next).toMatch(UUID)
      expect(next).not.toBe(lost)
    })

    it('shouldSayTheReportWasNotSharedAndKeepTheFormWhenTheRequestFails', async () => {
      serveDecision()
      serveShare(() => HttpResponse.error())
      const { user, panel } = renderPanel()

      await user.click(within(panel).getByRole('button', { name: 'Share with Server Admin' }))
      await user.click(within(panel).getByRole('button', { name: 'Send' }))

      expect(await within(panel).findByRole('alert')).toHaveTextContent(
        "Couldn't share the report. Try again.",
      )
      expect(within(panel).getByRole('button', { name: 'Send' })).toBeEnabled()
    })
  })
})
