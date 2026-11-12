import Hls, { type Fragment, type Level, PlaylistLevelType } from 'hls.js'

// hls.js 1.7.4 reports no progress of a segment that it loads whole. Its own abandon check reads
// the segment's load stats, which its loader updates as bytes arrive, this often.
const LOAD_CHECK_MS = 100

interface FirstSegmentStepDownOptions {
  hls: Hls
  video: Pick<HTMLMediaElement, 'readyState'>
  /** How long playback has left to start before the startup limit. */
  startupRemainingMs: () => number
  /** How long the first segment may receive no byte before playback starts on the lowest variant. */
  silenceLimitMs: number
}

interface Watch {
  timer: ReturnType<typeof setInterval>
  frag: Fragment
  loaded: number
  lastByteAt: number
}

/**
 * While the element has no data, watches the media segment that hls.js loads first. hls.js's own
 * abandon rule skips a load while the element has no data. When the bytes so far show that the
 * segment cannot arrive before the startup limit, or when no byte arrives for `silenceLimitMs`, hls.js
 * abandons the load and starts on the lowest variant that it could switch to from that one: the
 * same codecs and video range. From there hls.js adapts as usual.
 */
export function stepDownFromASlowFirstSegment({
  hls,
  video,
  startupRemainingMs,
  silenceLimitMs,
}: FirstSegmentStepDownOptions) {
  let watch: Watch | undefined

  function startWatching(frag: Fragment) {
    stopWatching()
    if (video.readyState !== HTMLMediaElement.HAVE_NOTHING) return
    if (lowestVariantBeneath(hls.levels, frag.level) === undefined) return
    const { stats } = frag
    const started: Watch = {
      timer: setInterval(() => check(started), LOAD_CHECK_MS),
      frag,
      loaded: stats.loaded,
      lastByteAt: stats.loading.start,
    }
    watch = started
  }

  function stopWatching() {
    clearInterval(watch?.timer)
    watch = undefined
  }

  function check(current: Watch) {
    const { stats } = current.frag
    if (stats.aborted || stats.loading.end > 0) {
      stopWatching()
      return
    }
    const now = performance.now()
    if (stats.loaded > current.loaded) {
      current.loaded = stats.loaded
      current.lastByteAt = now
    }
    if (now - current.lastByteAt < silenceLimitMs && arrivesInTime(current.frag, now)) return
    const lowest = lowestVariantBeneath(hls.levels, current.frag.level)
    if (lowest === undefined) {
      stopWatching()
      return
    }
    // hls.js loads the lowest variant's playlist, then aborts the segment of the variant it leaves.
    // An abort before that leaves hls.js waiting on the segment: until it has buffered media,
    // hls.js does not resume after an aborted load. When that playlist fails, hls.js can go back to
    // the segment's variant and leave the segment loading, so each later check asks again; hls.js
    // ignores a request for the variant that it is already switching to.
    hls.nextLoadLevel = lowest
  }

  function arrivesInTime(frag: Fragment, now: number): boolean {
    const { loaded, loading } = frag.stats
    // hls.js's own abandon rule also waits this long before it judges a load by its rate: a
    // transfer's first moments run below the link's rate.
    if (now - loading.start < (frag.duration * 1000) / 2 || loaded === 0) return true
    const bytesPerMs = loaded / (now - loading.first)
    return (segmentBytes(frag, hls.levels) - loaded) / bytesPerMs <= startupRemainingMs()
  }

  hls.on(Hls.Events.FRAG_LOADING, (_event, { frag }) => {
    if (frag.type === PlaylistLevelType.MAIN && frag.sn !== 'initSegment') startWatching(frag)
  })
  hls.on(Hls.Events.DESTROYING, stopWatching)
}

// hls.js switches only between variants with the same codecs and video range, and not to a variant
// that failed while its penalty lasts. The player's penalty outlasts the startup limit.
function lowestVariantBeneath(levels: readonly Level[], index: number): number | undefined {
  const loading = levels[index]
  const lowest = levels
    .filter(
      ({ codecSet, videoRange, loadError }) =>
        codecSet === loading.codecSet && videoRange === loading.videoRange && loadError === 0,
    )
    .reduce((low, level) => (level.bitrate < low.bitrate ? level : low), loading)
  return lowest === loading ? undefined : levels.indexOf(lowest)
}

// The response's length when the server sent one; otherwise what hls.js's own abandon rule expects.
function segmentBytes(frag: Fragment, levels: readonly Level[]): number {
  if (frag.stats.total > 0) return frag.stats.total
  return (frag.duration * (frag.bitrate || levels[frag.level].averageBitrate)) / 8
}
