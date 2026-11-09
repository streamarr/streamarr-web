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

## Streamarr findings and reproduction

The inspected web checkout is `c49922a72c22e2e9ee9020fbe721a09079f96780`. Its HEVC family fixes `maxTier` to `MAIN`, constructs only `L` tier codec strings, and stops at level 5.1. The HDR entry does advertise PQ, HLG, and Dolby Vision, so the declaration is not SDR-only. [Web probe configuration](https://github.com/streamarr/streamarr-web/blob/c49922a72c22e2e9ee9020fbe721a09079f96780/src/streaming/playbackCapabilities.ts#L184-L204), [picture limits](https://github.com/streamarr/streamarr-web/blob/c49922a72c22e2e9ee9020fbe721a09079f96780/src/streaming/playbackCapabilities.ts#L92-L107)

The web checkout pins server `5198450c18d2bcbda533b390542e43648ffab8f0`. At that revision, `VideoCodecProfileCapability.acceptsLevelAndTier` requires both the level and tier to fit. `VideoCapabilityEntry.codecProfileRefusal` emits `VIDEO_CODEC_LEVEL_NOT_DECLARED` when a listed profile has no matching level/tier capability. The reason covers two independent mismatches:

| Source | Declaration: level 5.1 / Main tier |
| --- | --- |
| Main 10, level 5.1, Main tier | Passes this check |
| Main 10, level 5.1, High tier | Fails tier |
| Main 10, level 5.2, Main tier | Fails level |
| Main 10, level 5.2, High tier | Fails both |

Other format checks still apply after this one. [Pinned server comparison](https://github.com/streamarr/streamarr-server/blob/5198450c18d2bcbda533b390542e43648ffab8f0/src/main/java/com/streamarr/server/domain/streaming/VideoCodecProfileCapability.java#L17-L25), [reason generation](https://github.com/streamarr/streamarr-server/blob/5198450c18d2bcbda533b390542e43648ffab8f0/src/main/java/com/streamarr/server/domain/streaming/VideoCapabilityEntry.java#L299-L319)

The regression suite exercises the declaration builder with injected browser answers. Positive answers for High tier and higher signaled levels expose the previous declaration ceiling; refusals and unanswered queries verify that support is not inferred without evidence. These tests establish declaration behavior, not sustained decoder throughput or physical HDR presentation.

## Implemented capability correction

The fix belongs to **streamarr-web**, in `src/streaming/playbackCapabilities.ts`. The pinned server contract already represents HEVC tier and level; no server or transcode-worker contract change is needed for this correction.

The declaration now asks Main and High tier independently through level 6.2, including 5.2, 6.0 and 6.1. These queries retain the existing picture sizes, frame rates and probe bitrates. Higher signaled levels do not imply larger pictures. Each profile and HDR base keeps its measured limits; lower-level refusals prevent wider declarations, and a High-tier entry must also fit the corresponding Main-tier answers. Safari's existing smoothness/power-efficiency policy and the shared three-second deadline remain in effect.

Direct-play questions use the declared tier and level and corroborate Main-tier support for High-tier entries. Dolby Vision remains on its separate, original measured entries. A regression also covers crossing picture/level ceilings that would otherwise produce 41 entries: the final list is limited to the contract's 32, retaining the H.264 encode fallback first and omitting excess optional combinations conservatively.

`src/streaming/hevcCapabilities.test.ts` covers the expanded matrix, while `Player.test.tsx` checks the capability payload submitted in `CreatePlaybackSession`. The older capability fixtures explicitly retain their original Main-tier question set; additional questions are unanswered in those fixtures rather than inheriting an unrestricted synthetic positive answer. Browser HDR and direct-play specs provide engine-level checks, not proof of physical HDR presentation.

Validation passed: 1,712 unit tests with coverage, TypeScript, ESLint, Prettier, production build, and 33 HDR/direct-play browser tests across Chromium, Firefox and WebKit. The production build's PostCSS `from` and chunk-size warnings were reproduced in a separate unchanged-HEAD build. The change adds 22 focused HEVC regressions and one Player/API-payload regression.
