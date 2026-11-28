#!/usr/bin/env bash
set -euo pipefail
: "${STREAMARR_WORKER_IMAGE:?Set the immutable worker image used for the proof}"
cd "$(dirname "$0")"
fixtures="$PWD"
ffmpeg_in_image() {
  docker run --rm --user 0:0 --cpus 2 --memory 1g \
    -v "$fixtures:/fixtures" --entrypoint /cnb/lifecycle/launcher \
    "$STREAMARR_WORKER_IMAGE" ffmpeg -hide_banner -loglevel error -nostdin "$@"
}
for codec in aac flac; do
  mkdir -p "$codec"
  ffmpeg_in_image -y \
    -f lavfi -i 'testsrc2=size=640x360:rate=24:duration=18' \
    -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=15' \
    -map 0:v:0 -map 1:a:0 -c:v libx264 -preset veryfast -crf 32 \
    -profile:v high -level:v 3.1 -pix_fmt yuv420p -g 144 -keyint_min 144 -sc_threshold 0 \
    -threads 2 -c:a "$codec" -ac 2 "/fixtures/$codec/source.mkv"
  ffmpeg_in_image -y -i "/fixtures/$codec/source.mkv" -map 0:v:0 -map 0:a:0 \
    -c copy -strict -2 -f hls -hls_time 6 -hls_playlist_type vod \
    -hls_segment_type fmp4 -hls_flags independent_segments \
    -hls_fmp4_init_filename init.mp4 \
    -hls_segment_filename "/fixtures/$codec/segment%d.m4s" "/fixtures/$codec/stream.m3u8"
  test "$(sed -n '/^#EXTINF:/p' "$codec/stream.m3u8" | wc -l)" -eq 3
  # The server advertises three six-second slots; FFmpeg's final EXTINF follows packet DTS.
  awk '/^#EXTINF:/ {$0 = "#EXTINF:6.000000,"} {print}' "$codec/stream.m3u8" > "$codec/stream.m3u8.tmp"
  mv "$codec/stream.m3u8.tmp" "$codec/stream.m3u8"
  ffmpeg_in_image -i "/fixtures/$codec/source.mkv" -map 0:a:0 -c copy \
    -f streamhash -hash sha256 - | sed -n '/^[0-9][0-9]*,a,SHA256=/p' > "$codec/source-audio.sha256"
  ffmpeg_in_image -allowed_extensions ALL -i "/fixtures/$codec/stream.m3u8" -map 0:a:0 -c copy \
    -f streamhash -hash sha256 - | sed -n '/^[0-9][0-9]*,a,SHA256=/p' > "$codec/hls-audio.sha256"
  test -s "$codec/source-audio.sha256"
  diff "$codec/source-audio.sha256" "$codec/hls-audio.sha256"
done
