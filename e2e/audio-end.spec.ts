import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  CreatePlaybackSessionMutation,
  CreatePlaybackSessionMutationVariables,
  DestroyPlaybackSessionMutation,
  DestroyPlaybackSessionMutationVariables,
  ReportStreamSessionTimelineMutation,
  ReportStreamSessionTimelineMutationVariables,
} from '../src/graphql/generated/graphql'
import { readyPlaybackSession } from '../src/test/playbackSession'
import { STUB_URL } from './ports'

test.use({ serviceWorkers: 'block' })

for (const codec of ['aac', 'flac']) {
  for (const scenario of ['play', 'seek16', 'start16']) {
    test(`${codec} ${scenario} ends the partly-audio final segment on the player`, async ({
      page,
      request,
    }, info) => {
      const directory = fileURLToPath(new URL(`fixtures/audio-end/${codec}/`, import.meta.url))
      test.skip(
        !existsSync(`${directory}/stream.m3u8`),
        'Generate the synthetic audio-end fixtures first',
      )
      const playlist = readFileSync(`${directory}/stream.m3u8`, 'utf8')
      const duration = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce(
        (sum, match) => sum + Number(match[1]),
        0,
      )
      const reports: Pick<
        ReportStreamSessionTimelineMutationVariables,
        'state' | 'positionSeconds'
      >[] = []
      const failures: unknown[] = []
      const messages: string[] = []
      const audioCodec = codec === 'aac' ? 'mp4a.40.2' : 'fLaC'
      const supported = await page.evaluate(
        (type) => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type),
        `video/mp4; codecs="avc1.64001f,${audioCodec}"`,
      )
      test.skip(!supported, `${codec} is unavailable in this engine's MediaSource`)
      await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
      await request.post(`${STUB_URL}/api/auth/refresh`)
      await page.route('**/graphql', (route) => {
        const body = route.request().postDataJSON() as {
          operationName: string
          variables: ReportStreamSessionTimelineMutationVariables
        }
        if (body.operationName === 'ReportStreamSessionTimeline') {
          reports.push(body.variables)
          return route.fulfill({
            json: { data: { reportStreamSessionTimeline: true } } satisfies {
              data: ReportStreamSessionTimelineMutation
            },
          })
        }
        if (body.operationName === 'ReportPlaybackFormatFailure') {
          failures.push(body.variables)
          return route.fulfill({ json: { errors: [{ message: 'No recovery fixture' }] } })
        }
        if (body.operationName === 'CreatePlaybackSession') {
          return route.fulfill({
            json: {
              data: {
                createPlaybackSession: {
                  playbackSession: {
                    id: 'playback-1',
                    formatAttemptCount: 1,
                    maximumFormatAttempts: 4,
                    requestedChoice: 'AUTO',
                    playbackChoice: 'AUTO',
                    formatChange: null,
                    offeredChoices: ['AUTO'],
                    currentFormatAttempt: {
                      __typename: 'ReadyPlaybackFormatAttempt',
                      streamSession: {
                        __typename: 'HlsStreamSession',
                        id: 'sess-1',
                        streamUrl: '/api/stream/proof/multivariant.m3u8',
                        transcodeMode: 'REMUX',
                        videoRange: 'SDR',
                        mediaEndSeconds: null,
                      },
                    },
                  },
                  userErrors: [],
                },
              },
            } satisfies { data: CreatePlaybackSessionMutation },
          })
        }
        if (body.operationName === 'DestroyPlaybackSession') {
          return route.fulfill({
            json: {
              data: { destroyPlaybackSession: { playbackSessionId: 'playback-1', userErrors: [] } },
            } satisfies { data: DestroyPlaybackSessionMutation },
          })
        }
        return route.continue()
      })
      await page.route('**/api/stream/proof/**', (route) => {
        const name = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
        if (name === 'multivariant.m3u8') {
          const start = scenario === 'start16' ? '#EXT-X-START:TIME-OFFSET=16,PRECISE=YES\n' : ''
          return route.fulfill({
            contentType: 'application/vnd.apple.mpegurl',
            body: `#EXTM3U\n${start}#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2"\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=640x360,CODECS="avc1.64001f,${audioCodec}",AUDIO="audio"\nstream.m3u8\n`,
          })
        }
        return route.fulfill({
          contentType: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
          path: `${directory}/${name}`,
        })
      })
      page.on('pageerror', (error) => messages.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') messages.push(message.text())
      })
      try {
        await page.goto(`/play/file-1${scenario === 'start16' ? '?position=16' : ''}`)
        const video = page.locator('video')
        await expect(video).toBeAttached()
        await video.evaluate((element: HTMLVideoElement) => {
          element.muted = true
          void element.play().catch(() => undefined)
        })
        if (scenario === 'seek16') {
          await expect
            .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
            .toBeGreaterThan(1)
          await video.evaluate((element: HTMLVideoElement) => {
            element.currentTime = 16
          })
        }
        await expect
          .poll(
            () =>
              reports.some((report) => report.state === 'STOPPED' && report.positionSeconds >= 18),
            { timeout: 35_000 },
          )
          .toBe(true)
        await expect
          .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
          .toBeGreaterThanOrEqual(17.9)
        await expect(video).toHaveJSProperty('paused', true)
        await expect(video).toHaveJSProperty('seeking', false)
        expect(failures).toEqual([])
      } finally {
        const video = await page
          .locator('video')
          .evaluate((element: HTMLVideoElement) => ({
            currentTime: element.currentTime,
            duration: element.duration,
            ended: element.ended,
            paused: element.paused,
            readyState: element.readyState,
            seeking: element.seeking,
            buffered: Array.from({ length: element.buffered.length }, (_, i) => [
              element.buffered.start(i),
              element.buffered.end(i),
            ]),
          }))
          .catch(() => null)
        writeFileSync(
          info.outputPath('result.json'),
          JSON.stringify(
            { codec, scenario, duration, reports, failures, messages, video },
            null,
            2,
          ),
        )
      }
    })
  }
}

for (const startPosition of [18, 21]) {
  test(`a resume at ${startPosition} seconds finishes without media and can replay`, async ({
    page,
    request,
  }) => {
    const directory = fileURLToPath(new URL('fixtures/audio-end/aac/', import.meta.url))
    test.skip(
      !existsSync(`${directory}/stream.m3u8`),
      'Generate the synthetic audio-end fixtures first',
    )
    const starts: (number | null | undefined)[] = []
    const stopped: number[] = []
    const destroyed: string[] = []
    let mediaRequests = 0
    await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
    await request.post(`${STUB_URL}/api/auth/refresh`)
    await page.route('**/graphql', (route) => {
      const body = route.request().postDataJSON() as { operationName: string; variables: unknown }
      if (body.operationName === 'CreatePlaybackSession') {
        const variables = body.variables as CreatePlaybackSessionMutationVariables
        starts.push(variables.input.startPositionSeconds)
        const playback = readyPlaybackSession({
          id: `playback-${starts.length}`,
          streamSession: {
            id: `stream-${starts.length}`,
            streamUrl: '/api/stream/proof/multivariant.m3u8',
            transcodeMode: 'REMUX',
            mediaEndSeconds: starts.length === 1 ? 18 : null,
          },
        })
        return route.fulfill({
          json: {
            data: { createPlaybackSession: { playbackSession: playback, userErrors: [] } },
          } satisfies { data: CreatePlaybackSessionMutation },
        })
      }
      if (body.operationName === 'ReportStreamSessionTimeline') {
        const variables = body.variables as ReportStreamSessionTimelineMutationVariables
        if (variables.state === 'STOPPED') stopped.push(variables.positionSeconds)
        return route.fulfill({
          json: { data: { reportStreamSessionTimeline: true } } satisfies {
            data: ReportStreamSessionTimelineMutation
          },
        })
      }
      if (body.operationName === 'DestroyPlaybackSession') {
        const variables = body.variables as DestroyPlaybackSessionMutationVariables
        const playbackSessionId = String(variables.input.playbackSessionId)
        destroyed.push(playbackSessionId)
        return route.fulfill({
          json: {
            data: {
              destroyPlaybackSession: {
                playbackSessionId,
                userErrors: [],
              },
            },
          } satisfies { data: DestroyPlaybackSessionMutation },
        })
      }
      return route.continue()
    })
    await page.route('**/api/stream/proof/**', (route) => {
      mediaRequests++
      const name = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
      if (name === 'multivariant.m3u8') {
        return route.fulfill({
          contentType: 'application/vnd.apple.mpegurl',
          body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=640x360,CODECS="avc1.64001f,mp4a.40.2"\nstream.m3u8\n',
        })
      }
      return route.fulfill({
        contentType: name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
        path: `${directory}/${name}`,
      })
    })
    await page.goto(`/play/file-1?position=${startPosition}`)
    const video = page.locator('video')
    await expect.poll(() => stopped).toContain(18)
    await expect(video).toHaveJSProperty('paused', true)
    expect(mediaRequests).toBe(0)

    await video.evaluate((element: HTMLVideoElement) => {
      element.muted = true
      void element.play().catch(() => undefined)
    })

    await expect.poll(() => starts).toEqual([startPosition, undefined])
    await expect.poll(() => destroyed).toContain('playback-1')
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(1)
    await expect(video).toHaveJSProperty('paused', false)
  })
}
