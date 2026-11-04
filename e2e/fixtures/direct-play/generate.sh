#!/bin/sh
# Writes the direct-play fixtures beside this script: one second of a 128x72 test pattern at
# 24 frames per second with a 440 Hz stereo tone, in each container and sample entry the web
# client declares. Run from anywhere with FFmpeg 8 built with libx264, libx265, libsvtav1 and
# libopus; e2e/direct-play.spec.ts reads the files it writes.
set -eu
cd "$(dirname "$0")"
export SVT_LOG=1

source_args='-f lavfi -i testsrc2=size=128x72:rate=24:duration=1 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=1'
common='-map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact -ac 2 -shortest'

# H.264 High with its parameter sets in the sample entry (avc1) and in the samples (avc3).
ffmpeg -y -hide_banner -loglevel error $source_args $common \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -tag:v avc1 \
  -c:a aac -b:a 64k -movflags +faststart h264-avc1.mp4
ffmpeg -y -hide_banner -loglevel error $source_args $common \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -tag:v avc3 \
  -c:a aac -b:a 64k -movflags +faststart h264-avc3.mp4

# HEVC Main with its parameter sets in the sample entry (hvc1) and in the samples (hev1).
ffmpeg -y -hide_banner -loglevel error $source_args $common \
  -c:v libx265 -profile:v main -pix_fmt yuv420p -x265-params log-level=error -tag:v hvc1 \
  -c:a aac -b:a 64k -movflags +faststart hevc-hvc1.mp4
ffmpeg -y -hide_banner -loglevel error $source_args $common \
  -c:v libx265 -profile:v main -pix_fmt yuv420p -x265-params log-level=error -tag:v hev1 \
  -c:a aac -b:a 64k -movflags +faststart hevc-hev1.mp4

# AV1 Main 8-bit with Opus, in MP4 (av01) and in WebM.
ffmpeg -y -hide_banner -loglevel error $source_args $common \
  -c:v libsvtav1 -pix_fmt yuv420p -preset 8 -svtav1-params enable-overlays=0 \
  -c:a libopus -b:a 64k -movflags +faststart av1-av01.mp4
ffmpeg -y -hide_banner -loglevel error $source_args $common \
  -c:v libsvtav1 -pix_fmt yuv420p -preset 8 -svtav1-params enable-overlays=0 \
  -c:a libopus -b:a 64k av1.webm

# HEVC Main 10 HDR10 (PQ in BT.2020 with SMPTE ST 2086 static metadata) as hvc1.
ffmpeg -y -hide_banner -loglevel error $source_args $common \
  -c:v libx265 -profile:v main10 -pix_fmt yuv420p10le -tag:v hvc1 \
  -x265-params 'log-level=error:hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400' \
  -c:a aac -b:a 64k -movflags +faststart hevc-hvc1-pq.mp4
