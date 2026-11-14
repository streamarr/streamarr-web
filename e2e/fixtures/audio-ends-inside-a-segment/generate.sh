#!/usr/bin/env bash
# Writes the fixtures of the player spec in which the audio ends before the video: four seconds of a
# synthetic test pattern as H.264 with a keyframe every two seconds, and a tone as FLAC in 100 ms
# frames that ends at 1.5 s, muxed into an fMP4 initialization segment and two media segments of two
# seconds each. The second media segment holds video and no audio, as a copy's last segment does
# when its audio ends inside the segment before it. Run from anywhere with FFmpeg 8 built with
# libx264.
set -euo pipefail
cd "$(dirname "$0")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i testsrc=size=320x180:rate=24:duration=4 \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=1.5' \
  -c:v libx264 -profile:v high -level 1.3 -pix_fmt yuv420p -g 48 \
  -x264-params keyint=48:min-keyint=48:scenecut=0 \
  -c:a flac -frame_size 4800 -ac 1 -sample_fmt s16 \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact \
  -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$work/segment%d.m4s" \
  "$work/stream.m3u8"
mv "$work/init.mp4" initialization-segment.mp4
mv "$work/segment0.m4s" media-segment-0.m4s
mv "$work/segment1.m4s" media-segment-1.m4s
