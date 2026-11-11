import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { LADDER_STREAM_PATH, routeLadderPlayback } from './ladderPlayback'

// Creating a stream session starts the variant that its multivariant playlist lists first, and the
// server starts any other variant on the player's first request for it. These specs serve Auto
// ladders in the server's order and record which variant hls.js asks for first. Media segment
// requests hang unless a spec answers the first one, so hls.js starts before it measures any.

test.use({ viewport: { width: 1512, height: 850 }, serviceWorkers: 'block' })

// Stereo AAC.
const AUDIO_BITRATE = 128_000

// As the server writes an encoded variant's BANDWIDTH: the tier's video bitrate plus the audio
// bitrate, and 20% over that average for its peak.
function encodedBandwidth(videoBitrate: number): number {
  const average = videoBitrate + AUDIO_BITRATE
  return average + Math.floor((average * 20) / 100)
}

interface Variant {
  /** The variant's media playlist, relative to the multivariant playlist. */
  playlist: string
  bandwidth: number
  resolution: string
  videoCodec: string
}

const ENCODED_1080P: Variant = {
  playlist: '1080p/stream.m3u8',
  bandwidth: encodedBandwidth(5_000_000),
  resolution: '1920x1080',
  videoCodec: 'avc1.640028',
}
const ENCODED_720P: Variant = {
  playlist: '720p/stream.m3u8',
  bandwidth: encodedBandwidth(3_000_000),
  resolution: '1280x720',
  videoCodec: 'avc1.64001f',
}
const ENCODED_480P: Variant = {
  playlist: '480p/stream.m3u8',
  bandwidth: encodedBandwidth(1_500_000),
  resolution: '854x480',
  videoCodec: 'avc1.64001e',
}
const ENCODED_360P: Variant = {
  playlist: '360p/stream.m3u8',
  bandwidth: encodedBandwidth(800_000),
  resolution: '640x360',
  videoCodec: 'avc1.64001e',
}

// A copy of a 1080p source that peaks at 20 Mb/s, listed first, with the H.264 variants that the
// server encodes beside it, highest first: each smaller than the copy, and lower in bandwidth
// (streamarr/streamarr-server#759, ADR 0050).
const COPY_LADDER: readonly Variant[] = [
  { ...ENCODED_1080P, playlist: 'stream.m3u8', bandwidth: 20_000_000 },
  ENCODED_720P,
  ENCODED_360P,
]

// A ladder of encodes lists first the variant whose average is nearest 2 Mb/s, then the others from
// highest to lowest (ADR 0008). The 1080p variant peaks above 5 Mb/s.
const ENCODE_LADDER: readonly Variant[] = [ENCODED_480P, ENCODED_1080P, ENCODED_720P, ENCODED_360P]

function multivariant(variants: readonly Variant[], startPositionSeconds?: number): string {
  return [
    '#EXTM3U',
    ...(startPositionSeconds === undefined
      ? []
      : [`#EXT-X-START:TIME-OFFSET=${startPositionSeconds},PRECISE=YES`]),
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2"',
    ...variants.flatMap(({ playlist, bandwidth, resolution, videoCodec }) => [
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},CODECS="${videoCodec},mp4a.40.2",AUDIO="audio"`,
      `${playlist}?t=playback-token`,
    ]),
    '',
  ].join('\n')
}

const SEGMENT_SECONDS = 6
const DURATION_SECONDS = 2824

// Six-second segments, as the server's default target duration cuts them.
function mediaPlaylist(): string {
  const segments = Array.from(
    { length: Math.ceil(DURATION_SECONDS / SEGMENT_SECONDS) },
    (_, index) => [
      `#EXTINF:${Math.min(SEGMENT_SECONDS, DURATION_SECONDS - index * SEGMENT_SECONDS)}.0,`,
      `segment${index}.m4s`,
    ],
  )
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-MAP:URI="init.mp4"',
    ...segments.flat(),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n')
}

interface LadderRoutes {
  variants: readonly Variant[]
  transcodeMode: string
  startPositionSeconds?: number
  /** Once it settles, each variant's first media segment is answered; until then it is held. */
  firstSegmentAnswered?: Promise<void>
}

interface Requests {
  /** Each media playlist hls.js asked for, in order, relative to the multivariant playlist. */
  mediaPlaylists: string[]
  /** Each media segment hls.js asked for, in order, relative to the multivariant playlist. */
  segments: string[]
}

// Serves an Auto playback session whose multivariant playlist lists `variants`, and records the
// media playlists and media segments that hls.js asks for.
async function serveLadder(
  page: Page,
  request: APIRequestContext,
  { variants, transcodeMode, startPositionSeconds, firstSegmentAnswered }: LadderRoutes,
): Promise<Requests> {
  const requests: Requests = { mediaPlaylists: [], segments: [] }
  await routeLadderPlayback(page, request, { choice: 'AUTO', transcodeMode })
  await page.route(`**${LADDER_STREAM_PATH}multivariant.m3u8*`, (route) =>
    route.fulfill({
      contentType: 'application/vnd.apple.mpegurl',
      body: multivariant(variants, startPositionSeconds),
    }),
  )
  await page.route(/\/api\/stream\/ladder\/(?:\w+\/)?stream\.m3u8/, (route) => {
    requests.mediaPlaylists.push(underStream(route.request()))
    return route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: mediaPlaylist() })
  })
  // hls.js asks for a media segment only once it holds the initialization segment. The fixtures are
  // ten seconds of black 720p H.264 and silent stereo AAC.
  await page.route(/\/api\/stream\/ladder\/(?:\w+\/)?init\.mp4/, (route) =>
    route.fulfill({ contentType: 'video/mp4', path: fixture('initialization-segment.mp4') }),
  )
  await page.route(/\/api\/stream\/ladder\/.*\.m4s/, async (route) => {
    const segment = underStream(route.request())
    requests.segments.push(segment)
    if (!firstSegmentAnswered || !isFirstSegment(segment)) return new Promise(() => undefined)
    await firstSegmentAnswered
    return route.fulfill({ contentType: 'video/mp4', path: fixture('media-segment.m4s') })
  })
  return requests
}

function underStream(call: Request): string {
  return new URL(call.url()).pathname.slice(LADDER_STREAM_PATH.length)
}

function fixture(name: string): string {
  return fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))
}

function isFirstSegment(segment: string): boolean {
  return /(?:^|\/)segment0\.m4s$/.test(segment)
}

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) await page.unrouteAll({ behavior: 'ignoreErrors' })
})

for (const { ladder, transcodeMode, variants, first } of [
  {
    ladder: 'a 20 Mb/s copy above its 720p and 360p variants',
    transcodeMode: 'REMUX',
    variants: COPY_LADDER,
    first: '',
  },
  {
    ladder: 'a ladder of encodes, the variant nearest 2 Mb/s',
    transcodeMode: 'VIDEO_TRANSCODE',
    variants: ENCODE_LADDER,
    first: '480p/',
  },
]) {
  test(`Auto starts on the first-listed variant of ${ladder}`, async ({ page, request }) => {
    const requests = await serveLadder(page, request, { variants, transcodeMode })

    await page.goto('/play/file-1?movie=m1')

    await expect.poll(() => requests.segments).not.toHaveLength(0)
    expect(requests.mediaPlaylists[0]).toBe(`${first}stream.m3u8`)
    expect(requests.segments[0]).toBe(`${first}segment0.m4s`)
  })
}

test('Auto starts at the start position in the first-listed variant', async ({ page, request }) => {
  const requests = await serveLadder(page, request, {
    variants: COPY_LADDER,
    transcodeMode: 'REMUX',
    startPositionSeconds: 603,
  })

  await page.goto('/play/file-1?movie=m1&position=603')

  await expect.poll(() => requests.segments).not.toHaveLength(0)
  expect(requests.mediaPlaylists[0]).toBe('stream.m3u8')
  expect(requests.segments[0]).toBe('segment100.m4s')
})

// The element keeps a seek made before it has metadata as the position to start from, and seeks
// there once the first segment gives it metadata. Only then does hls.js learn of the seek.
test('a seek while the first segment of the first-listed variant loads moves playback to the segment that holds the seek target', async ({
  page,
  request,
}) => {
  let answerFirstSegment = () => {}
  const firstSegmentAnswered = new Promise<void>((resolve) => {
    answerFirstSegment = resolve
  })
  const requests = await serveLadder(page, request, {
    variants: COPY_LADDER,
    transcodeMode: 'REMUX',
    firstSegmentAnswered,
  })
  await page.goto('/play/file-1?movie=m1')
  await expect.poll(() => requests.segments).not.toHaveLength(0)
  const forward = page.getByRole('button', { name: 'Forward 10 seconds' })

  // To 30 s, which segment 5 holds; the first segment's ten seconds end inside segment 1.
  for (let press = 0; press < 3; press++) await forward.click()
  answerFirstSegment()

  await expect
    .poll(() => requests.segments)
    .toContainEqual(expect.stringMatching(/(?:^|\/)segment5\.m4s$/))
  expect(requests.segments[0]).toBe('segment0.m4s')
})
