import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LADDER_STREAM_PATH, routeLadderPlayback } from './ladderPlayback'

// Creating a stream session starts the variant that its multivariant playlist lists first, and the
// server starts any other variant on the player's first request for it. These specs serve Auto
// ladders in the server's order and record which variant hls.js asks for first. Media segment
// requests hang unless a spec answers the first one, so hls.js starts before it measures any. The
// last specs slow the first segment down, and the player starts on the lowest variant when the
// first-listed one cannot start within the startup limit.

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
  /** The playback choice; Auto unless named. */
  choice?: string
  transcodeMode: string
  startPositionSeconds?: number
  /** Variants whose media playlist is answered with 404. */
  missingPlaylists?: readonly Variant[]
  /** Once it settles, each variant's first media segment is answered; until then it is held. */
  firstSegmentAnswered?: Promise<void>
  /** How each variant's first media segment arrives. 'never' leaves the request unanswered. */
  firstSegmentTransfer?: (variant: Variant) => Transfer | 'never'
}

/**
 * How a first media segment crosses the link: its headers come after `heldMs`, then its bytes in
 * legs, each leg `share` of them in ten even chunks over `ms`.
 */
interface Transfer {
  heldMs: number
  legs: readonly { share: number; ms: number }[]
}

// Headers at once, then the bytes in ten even chunks over `ms`.
function evenly(ms: number): Transfer {
  return { heldMs: 0, legs: [{ share: 1, ms }] }
}

interface Requests {
  /** Each media playlist hls.js asked for, in order, relative to the multivariant playlist. */
  mediaPlaylists: string[]
  /** Each media segment hls.js asked for, in order, relative to the multivariant playlist. */
  segments: string[]
}

// Serves a playback session whose multivariant playlist lists `variants`, and records the
// media playlists and media segments that hls.js asks for.
async function serveLadder(
  page: Page,
  request: APIRequestContext,
  {
    variants,
    choice = 'AUTO',
    transcodeMode,
    startPositionSeconds,
    missingPlaylists = [],
    firstSegmentAnswered,
    firstSegmentTransfer,
  }: LadderRoutes,
): Promise<Requests> {
  const requests: Requests = { mediaPlaylists: [], segments: [] }
  await routeLadderPlayback(page, request, { choice, transcodeMode })
  await page.route(`**${LADDER_STREAM_PATH}multivariant.m3u8*`, (route) =>
    route.fulfill({
      contentType: 'application/vnd.apple.mpegurl',
      body: multivariant(variants, startPositionSeconds),
    }),
  )
  await page.route(/\/api\/stream\/ladder\/(?:\w+\/)?stream\.m3u8/, (route) => {
    const playlist = underStream(route.request())
    requests.mediaPlaylists.push(playlist)
    if (missingPlaylists.some((missing) => missing.playlist === playlist)) {
      return route.fulfill({ status: 404 })
    }
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
    if (firstSegmentTransfer && isFirstSegment(segment)) {
      const transfer = firstSegmentTransfer(variantOf(variants, segment))
      if (transfer === 'never') return new Promise(() => undefined)
      const query = new URLSearchParams({ transfer: JSON.stringify(transfer), segment })
      return route.continue({ url: `${trickle.url}?${query}` })
    }
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

function variantOf(variants: readonly Variant[], segment: string): Variant {
  const variant = variants.find(
    ({ playlist }) => posix.dirname(playlist) === posix.dirname(segment),
  )
  expect(variant, `the variant that holds ${segment}`).toBeDefined()
  return variant!
}

const CHUNKS_PER_LEG = 10

// Each chunk of a transfer's `legs` over `length` bytes: the bytes it carries, and when it is
// written after the headers.
function chunksOf(legs: Transfer['legs'], length: number) {
  let shareBefore = 0
  let msBefore = 0
  return legs.flatMap(({ share, ms }) => {
    const chunks = Array.from({ length: CHUNKS_PER_LEG }, (_, chunk) => ({
      start: Math.ceil((shareBefore + (share * chunk) / CHUNKS_PER_LEG) * length),
      end: Math.ceil((shareBefore + (share * (chunk + 1)) / CHUNKS_PER_LEG) * length),
      atMs: msBefore + (ms * (chunk + 1)) / CHUNKS_PER_LEG,
    }))
    shareBefore += share
    msBefore += ms
    return chunks
  })
}

// Answers with the fixture's media segment as the `transfer` that the query names, as a link
// slower than the segment's bit rate delivers it. Counts the chunks it has written of each
// `segment` that a query names.
let trickle: { url: string; server: Server; chunksWritten: Map<string, number> }

test.beforeAll(async () => {
  const segment = await readFile(fixture('media-segment.m4s'))
  const chunksWritten = new Map<string, number>()
  const server = createServer((request, response) => {
    const query = new URL(request.url ?? '', 'http://trickle').searchParams
    const { heldMs, legs } = JSON.parse(query.get('transfer') ?? '') as Transfer
    const requested = query.get('segment') ?? ''
    chunksWritten.set(requested, 0)
    const chunks = chunksOf(legs, segment.length)
    const timers = [
      setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': segment.length })
        response.flushHeaders()
      }, heldMs),
      ...chunks.map(({ start, end, atMs }, chunk) =>
        setTimeout(() => {
          response.write(segment.subarray(start, end))
          chunksWritten.set(requested, chunk + 1)
          if (chunk === chunks.length - 1) response.end()
        }, heldMs + atMs),
      ),
    ]
    response.on('close', () => timers.forEach(clearTimeout))
  })
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
  trickle = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    server,
    chunksWritten,
  }
})

// Each spec counts only the chunks of the segments that its own page asks for.
test.beforeEach(() => {
  trickle.chunksWritten.clear()
})

test.afterAll(async () => {
  trickle.server.closeAllConnections()
  await new Promise((closed) => trickle.server.close(closed))
})

// A link below the copy's peak and above its 720p variant's.
const SLOW_LINK_BITS_PER_SECOND = 2_000_000
// A link that carries the copy's first segment in 12 s.
const FAST_LINK_BITS_PER_SECOND = 10_000_000

// How long a segment that runs at its variant's BANDWIDTH for its six seconds takes to cross a link
// of `bitsPerSecond`. Over the slow link: 60 s for the copy, 11.3 s for the 720p variant and 3.3 s
// for the 360p variant.
function overALink(bitsPerSecond: number): (variant: Variant) => Transfer {
  return ({ bandwidth }) => evenly((bandwidth * SEGMENT_SECONDS * 1_000) / bitsPerSecond)
}

// The player gives up on startup after 30 s and says so.
const STARTUP_LIMIT_MS = 30_000

// 'started' once the element has metadata. A startup that timed out names the segments that hls.js
// asked for, so a failure shows which variant it waited on.
async function startup(page: Page, { segments }: Requests): Promise<string> {
  if (await page.getByText('Playback is taking too long to start').isVisible()) {
    return `timed out after asking for ${segments.join(', ')}`
  }
  const hasMetadata = await page.evaluate(
    () => (document.querySelector('video')?.readyState ?? 0) >= HTMLMediaElement.HAVE_METADATA,
  )
  return hasMetadata ? 'started' : 'starting'
}

// Opens the player and waits until startup ends: how it ended, and how long after the page was
// opened. The player's own count starts later, once the page has loaded.
async function playUntilStartupEnds(page: Page, requests: Requests) {
  const openedAt = Date.now()
  await page.goto('/play/file-1?movie=m1')
  await expect
    .poll(() => startup(page, requests), { timeout: STARTUP_LIMIT_MS + 5_000, intervals: [100] })
    .not.toBe('starting')
  const ended = { outcome: await startup(page, requests), afterMs: Date.now() - openedAt }
  test.info().annotations.push({ type: 'startup', description: JSON.stringify(ended) })
  return ended
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

// Startup ends when the element has metadata, which it gets only from a whole first segment. The
// first-listed copy's first segment is too large to cross the link before the startup limit,
// while the 360p variant's crosses it in 3.3 s.
test('Auto starts on the lowest variant within the startup limit on a link slower than the first-listed copy', async ({
  page,
  request,
}) => {
  const requests = await serveLadder(page, request, {
    variants: COPY_LADDER,
    transcodeMode: 'REMUX',
    firstSegmentTransfer: overALink(SLOW_LINK_BITS_PER_SECOND),
  })

  const { outcome, afterMs } = await playUntilStartupEnds(page, requests)

  expect(outcome).toBe('started')
  expect(afterMs).toBeLessThan(STARTUP_LIMIT_MS)
  expect(requests.segments.filter(isFirstSegment)).toEqual(['segment0.m4s', '360p/segment0.m4s'])
})

// The lowest variant's first segment arrives at once, so hls.js, adapting as usual once it has
// measured it, moves up to the copy for the next segment.
test('Auto starts on the lowest variant within the startup limit when the first-listed variant never answers its first segment, and adapts from there', async ({
  page,
  request,
}) => {
  const requests = await serveLadder(page, request, {
    variants: COPY_LADDER,
    transcodeMode: 'REMUX',
    firstSegmentTransfer: (variant) => (variant === COPY_LADDER[0] ? 'never' : evenly(0)),
  })

  const { outcome, afterMs } = await playUntilStartupEnds(page, requests)

  expect(outcome).toBe('started')
  expect(afterMs).toBeLessThan(STARTUP_LIMIT_MS)
  expect(requests.segments.filter(isFirstSegment)).toEqual(['segment0.m4s', '360p/segment0.m4s'])
  await expect.poll(() => requests.segments).toContain('segment1.m4s')
})

// hls.js leaves a variant whose playlist failed out of its choices and goes back to the copy's
// first segment, which keeps loading over the slow link. The player then starts on the lowest
// variant left. Once hls.js has measured that variant's segment, it adapts as usual: below every
// variant's bandwidth, it asks for the lowest one even after a failure. So only the first
// playlists that it asked for show the step down.
test('Auto starts on the lowest variant left within the startup limit when the lowest variant fails', async ({
  page,
  request,
}) => {
  const requests = await serveLadder(page, request, {
    variants: COPY_LADDER,
    transcodeMode: 'REMUX',
    missingPlaylists: [ENCODED_360P],
    firstSegmentTransfer: overALink(SLOW_LINK_BITS_PER_SECOND),
  })

  const { outcome, afterMs } = await playUntilStartupEnds(page, requests)

  expect(outcome).toBe('started')
  expect(afterMs).toBeLessThan(STARTUP_LIMIT_MS)
  expect(requests.mediaPlaylists.slice(0, 3)).toEqual([
    'stream.m3u8',
    '360p/stream.m3u8',
    '720p/stream.m3u8',
  ])
})

// Once it has measured the first segment, hls.js adapts as usual, so only the first segments that
// it asked for show where playback started.
test('Auto keeps the first-listed copy when its first segment crosses the link within the startup limit', async ({
  page,
  request,
}) => {
  const requests = await serveLadder(page, request, {
    variants: COPY_LADDER,
    transcodeMode: 'REMUX',
    firstSegmentTransfer: overALink(FAST_LINK_BITS_PER_SECOND),
  })

  const { outcome, afterMs } = await playUntilStartupEnds(page, requests)

  expect(outcome).toBe('started')
  expect(afterMs).toBeLessThan(STARTUP_LIMIT_MS)
  expect(requests.segments.filter(isFirstSegment)).toEqual(['segment0.m4s'])
})

// Original and each fixed quality list one variant, and so does Auto for a copy without encodes
// beside it. With no lower variant, the slow first segment keeps loading, as before the step down.
// With a lower variant, a first segment that receives no byte for a quarter of the startup limit
// gives way to the lowest variant, and so does one whose bytes show it cannot arrive within the
// limit, by the time its first tenth crosses the link.
for (const { listing, choice, variant, transcodeMode } of [
  {
    listing: 'Auto with the copy alone',
    choice: 'AUTO',
    variant: COPY_LADDER[0],
    transcodeMode: 'REMUX',
  },
  {
    listing: 'the fixed quality 1080p',
    choice: 'FULL_HD_1080P',
    variant: ENCODED_1080P,
    transcodeMode: 'VIDEO_TRANSCODE',
  },
]) {
  test(`${listing} keeps loading the first segment of its one variant on a link slower than it`, async ({
    page,
    request,
  }) => {
    const firstSegment = posix.join(posix.dirname(variant.playlist), 'segment0.m4s')
    const requests = await serveLadder(page, request, {
      variants: [variant],
      choice,
      transcodeMode,
      firstSegmentTransfer: () => evenly(2 * STARTUP_LIMIT_MS),
    })

    await page.goto('/play/file-1?movie=m1')

    // The first tenth already shows that the rest cannot arrive within the limit; the second
    // crosses the link a tenth of the transfer later.
    await expect
      .poll(() => trickle.chunksWritten.get(firstSegment) ?? 0, {
        message: `the tenths of ${firstSegment} that crossed the link`,
        timeout: STARTUP_LIMIT_MS,
      })
      .toBeGreaterThanOrEqual(2)
    expect(await startup(page, requests)).toBe('starting')
    expect(requests.segments).toEqual([firstSegment])
  })
}
