# HEVC tier and level capability evidence

Researched 2026-11-09 against public browser source. This note explains HEVC tier and level limits in capability declarations and the limits of browser capability queries as evidence of playback support.

## Profile, tier, and level are different limits

Main 10 is a **profile**; it does not imply Main tier. A Main 10 stream may use Main or High tier. In HEVC codec strings, `L153` means Main tier at level 5.1, `H153` means High tier at 5.1, and `L156`/`H156` mean the corresponding tiers at 5.2. The level indicator is 30 times the level number; Streamarr's `51` is a separate representation. [ITU-T H.265 V11, Annex A.4.1](https://www.itu.int/rec/T-REC-H.265-202601-I/en), [WebKit codec parser, lines 180-197](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/HEVCUtilities.cpp#L180-L197)

For Main/Main 10, the limits are:

| Level | Main tier VCL bitrate | High tier VCL bitrate | Main/High NAL bitrate |
| --- | --- | --- | --- |
| 5.1 | 40 Mbps | 160 Mbps | 44 / 176 Mbps |
| 5.2 | 60 Mbps | 240 Mbps | 66 / 264 Mbps |

These derive from Table A.9 and the VCL/NAL scale factors in A.4.2 and Table A.10. A measured file or container bitrate is not a substitute for the coded stream's profile-tier-level signaling and HRD conformance. Check the coded tier and level before attributing a capability refusal to High tier. [ITU-T H.265 V11, printed pages 263-266](https://www.itu.int/rec/dologin_pub.asp?id=T-REC-H.265-202601-I%21%21PDF-E&lang=e&type=items)

## What browser probes actually check

**WebKit/Cocoa:** the MediaCapabilities path parses HEVC and calls `validateHEVCParameters`. That validator checks the profile against VideoToolbox, compares the requested level with `MaxDecodeLevel`, and derives `smooth` from `MaxPlaybackLevel`. It does not inspect `generalTierFlag`; its caller does not supply bitrate, width, height, or frame rate to this validator. The earlier MIME gate delegates to Apple's AVStreamDataParser, whose internals are not present in WebKit. Consequently, the visible source supports a real level check, but does not establish an independent High-tier throughput check; it also does not justify claiming that every Safari version ignores tier. [Dispatch, lines 94-104](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/cocoa/PlatformMediaEngineConfigurationFactoryCocoa.cpp#L94-L104), [HEVC validation, lines 50-130](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/cocoa/HEVCUtilitiesCocoa.mm#L50-L130), [MIME delegation, lines 204-213](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/avfoundation/objc/SourceBufferParserAVFObjC.mm#L204-L213)

**Chromium:** its HEVC parser validates `L`/`H`, but discards the parsed tier when constructing `VideoType`. The common HEVC decoder-support function checks color space and profile availability, not the requested level. Both MIME support and MediaCapabilities use that support path. Thus an `H153` answer can equal `L153` without independently testing the tier. [Parser, lines 693-707 and 796-806](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/media/base/video_codec_string_parsers.cc#L693-L707), [HEVC support, lines 232-252](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/media/base/supported_types.cc#L232-L252), [MIME support, lines 979-984](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/media/base/mime_util_internal.cc#L979-L984)

Chromium's clear-content MediaCapabilities performance prediction uses profile, dimensions, and frame rate; its GPU query builds a decoder configuration without bitstream parameter sets. Neither operation here includes bitrate or HEVC tier. This is why setting a larger `bitrate` in a query is appropriate input but cannot be treated as a measured throughput test. These source observations describe the inspected revisions, not a guarantee for every shipped browser build. [MediaCapabilities, lines 1409-1538](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/third_party/blink/renderer/modules/media_capabilities/media_capabilities.cc#L1409-L1538)

## Recommended confirmation

1. Record the source and delivered initialization segment's HEVC profile, tier, level, codec string, and Dolby Vision profile/base-layer compatibility. Preserve the server's concrete rejection reason. A 5.2 Main-tier source and a 5.1 High-tier source both exceed a 5.1/Main declaration, for different reasons.
2. Probe the exact hls.js `media-source` path with separate Main/High tier strings at 5.1 and 5.2, retaining the other codec fields and HDR questions. Supply representative dimensions, frame rate, and bitrate; record all of `supported`, `smooth`, and `powerEfficient`. Do not derive High-tier support from a Main-tier result.
3. Validate with correctly signaled, representative High-tier fMP4 samples on real target browsers/devices, including sustained high bitrate. Confirm decoder errors, dropped frames, and HDR output. A passing query, or a low-bitrate file merely labeled High tier, does not prove the higher bitrate capability.

Independent High-tier probes can remove an artificial declaration ceiling, but browser-query limitations mean they must not be described as proof of the decoder's entire High-tier envelope. Dolby Vision compatibility remains a separate requirement; HEVC Main 10 and PQ alone do not establish support for the source's Dolby Vision profile.

## Implementation

`src/streaming/playbackCapabilities.ts` probes HEVC Main and High tiers independently through level 6.2 at the existing picture sizes, frame rates and bitrates. Each profile and HDR base retains its own limits, and High-tier declarations require corresponding Main-tier support. Safari's support policy and the shared probe deadline remain in effect; Dolby Vision uses separate probes.

Direct-play checks use the declared tier and level. The declaration stays within the server contract's 32-entry limit, retaining the H.264 fallback first. The existing server contract supports these fields, so this correction requires no server or transcode-worker changes.
