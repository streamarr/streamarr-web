#!/usr/bin/env bash
# Writes the PQ fixtures of e2e/hdr-playlist.spec.ts: two seconds of a synthetic test pattern as
# 10-bit AV1 tagged BT.2020, SMPTE ST 2084 (PQ) and BT.2020 non-constant luminance, with HDR10
# mastering display metadata, split into an fMP4 initialization segment and one media segment.
# Needs an FFmpeg built with libsvtav1.
set -euo pipefail
cd "$(dirname "$0")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x360:rate=24:duration=2 \
  -vf 'format=yuv420p10le' \
  -c:v libsvtav1 -preset 10 -crf 40 -g 48 \
  -svtav1-params 'enable-hdr=1:color-primaries=bt2020:transfer-characteristics=smpte2084:matrix-coefficients=bt2020-ncl:mastering-display=G(0.17,0.797)B(0.131,0.046)R(0.708,0.292)WP(0.3127,0.329)L(1000,0.0001):content-light=1000,400' \
  -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc -color_range tv \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$work/segment%d.m4s" \
  "$work/stream.m3u8"
mv "$work/init.mp4" initialization-segment.mp4
mv "$work/segment0.m4s" media-segment.m4s
