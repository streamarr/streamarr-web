import type { ActiveStreamFieldsFragment } from '../../graphql/generated/graphql'
import { formatEpisodeLabel } from '../../media/formatting'
import { pickImageVariant, type PickedImage } from '../../media/images'

type Stream = ActiveStreamFieldsFragment

export type StreamKind = 'DIRECT_PLAY' | 'COPY' | 'ENCODE' | 'PREPARING'
export type KindFilter = 'ALL' | StreamKind
export type StreamSort = 'VIEWER' | 'TITLE' | 'TIME_LEFT' | 'OUTPUT'

export const KIND_LABELS: Record<StreamKind, string> = {
  DIRECT_PLAY: 'Direct play',
  COPY: 'Copy',
  ENCODE: 'Encode',
  PREPARING: 'Preparing',
}

export const SORT_LABELS: Record<StreamSort, string> = {
  VIEWER: 'Viewer',
  TITLE: 'Title',
  TIME_LEFT: 'Time left',
  OUTPUT: 'Output bitrate',
}

const UNMATCHED = 'A file without a matched title'

/**
 * The heaviest work a stream's tracks need: one encoded track makes the stream an encode. Null
 * when a track's delivery is newer than the pinned schema, rather than a delivery the page knows.
 */
export function streamKind({ decision }: Stream): StreamKind | null {
  if (!decision) return 'PREPARING'
  const deliveries = [decision.video.delivery, decision.audio?.delivery ?? 'DIRECT_PLAY']
  if (!deliveries.every(isKnownDelivery)) return null
  if (deliveries.includes('ENCODE')) return 'ENCODE'
  return deliveries.includes('COPY') ? 'COPY' : 'DIRECT_PLAY'
}

const KNOWN_DELIVERIES: ReadonlySet<string> = new Set(['DIRECT_PLAY', 'COPY', 'ENCODE'])

function isKnownDelivery(delivery: string): boolean {
  return KNOWN_DELIVERIES.has(delivery)
}

/**
 * The format attempt's output: its video and, when it has one, its audio. For an encode the video
 * is the largest variant it offers, so the player may take less.
 */
export function outputBitrate({ decision }: Stream): number | null {
  const video = decision?.video.output.bitrate
  const audio = decision?.audio ? decision.audio.output.bitrate : 0
  if (video == null || audio === null) return null
  return video + audio
}

/** The title a viewer knows the stream by: the show for an episode, the movie otherwise. */
export function streamTitle({ media }: Stream): string {
  if (!media) return UNMATCHED
  if (media.__typename === 'Movie') return media.title ?? UNMATCHED
  return media.season.series.title ?? media.title ?? UNMATCHED
}

/** The episode's place and name, or null for a movie or an unmatched file. */
export function episodeLine({ media }: Stream): string | null {
  if (media?.__typename !== 'Episode') return null
  const label = formatEpisodeLabel(media.season.seasonNumber, media.episodeNumber)
  return media.title ? `${label} · ${media.title}` : label
}

export function streamPoster({ media }: Stream): {
  image: PickedImage | null
  blurHash: string | null
} {
  const poster = media?.__typename === 'Episode' ? media.season.series.images[0] : media?.images[0]
  return { image: pickImageVariant(poster, 'MEDIUM'), blurHash: poster?.blurHash ?? null }
}

export function viewerName({ profile }: Stream): string {
  return profile.name ?? 'A deleted Profile'
}

function runtimeSeconds({ media }: Stream): number | null {
  return media?.runtime ? media.runtime * 60 : null
}

/** How far into the title the stream is, from the metadata runtime, so only approximate. */
export function progressPercent(stream: Stream): number | null {
  const runtime = runtimeSeconds(stream)
  if (stream.positionSeconds === null || !runtime) return null
  return Math.min(100, (stream.positionSeconds / runtime) * 100)
}

/** Where the produced stretch sits on the title's runtime, in percent, or null without either. */
export function producedSpan(stream: Stream): { left: number; width: number } | null {
  const runtime = runtimeSeconds(stream)
  const range = stream.producedRange
  if (!range || !runtime) return null
  const { startSeconds, endSeconds } = range
  return {
    left: (startSeconds / runtime) * 100,
    width: ((endSeconds - startSeconds) / runtime) * 100,
  }
}

function secondsLeft(stream: Stream): number {
  const runtime = runtimeSeconds(stream)
  if (stream.positionSeconds === null || !runtime) return Number.POSITIVE_INFINITY
  return runtime - stream.positionSeconds
}

const SORTS: Record<StreamSort, (a: Stream, b: Stream) => number> = {
  VIEWER: (a, b) =>
    viewerName(a).localeCompare(viewerName(b)) || streamTitle(a).localeCompare(streamTitle(b)),
  TITLE: (a, b) =>
    streamTitle(a).localeCompare(streamTitle(b)) || viewerName(a).localeCompare(viewerName(b)),
  TIME_LEFT: (a, b) => secondsLeft(a) - secondsLeft(b),
  OUTPUT: (a, b) => (outputBitrate(b) ?? -1) - (outputBitrate(a) ?? -1),
}

function matchesQuery(stream: Stream, query: string): boolean {
  if (!query) return true
  const words = [viewerName(stream), streamTitle(stream), episodeLine(stream), stream.deviceName]
  return words.some((word) => word?.toLowerCase().includes(query))
}

export function visibleStreams(
  streams: readonly Stream[],
  view: { kind: KindFilter; worker: string | null; query: string; sort: StreamSort },
): Stream[] {
  const query = view.query.trim().toLowerCase()
  return streams
    .filter((stream) => view.kind === 'ALL' || streamKind(stream) === view.kind)
    .filter((stream) => !view.worker || stream.workers.includes(view.worker))
    .filter((stream) => matchesQuery(stream, query))
    .sort(SORTS[view.sort])
}

export function kindCounts(streams: readonly Stream[]): Record<StreamKind, number> {
  const counts: Record<StreamKind, number> = { DIRECT_PLAY: 0, COPY: 0, ENCODE: 0, PREPARING: 0 }
  for (const stream of streams) {
    const kind = streamKind(stream)
    if (kind) counts[kind] += 1
  }
  return counts
}

export function workerNames(streams: readonly Stream[]): string[] {
  return [...new Set(streams.flatMap((stream) => stream.workers))].sort()
}

/**
 * The streams' summed output, or null when none has started or any started one's output is not
 * known: a partial sum would read as the whole.
 */
export function outputTotal(streams: readonly Stream[]): number | null {
  const started = streams.filter((stream) => stream.decision)
  const outputs = started.map(outputBitrate)
  if (started.length === 0 || outputs.includes(null)) return null
  return outputs.reduce<number>((total, output) => total + (output ?? 0), 0)
}
