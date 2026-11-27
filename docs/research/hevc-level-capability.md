# HEVC level evidence in browsers

ADR 0049 lets a client declare a codec level above the level that its picture needs only on evidence about that level. One kind of evidence is a platform that answers for the level and compares the level with its decoder. This note records what WebKit and Chromium do with the level of an HEVC question, and what Safari answered.

The links point at the source revisions that were read. A shipped browser build can differ from them.

## How a codec string carries the level

An HEVC codec string writes the level as 30 times the level number, after `L` for the Main tier or `H` for the High tier. `L153` is level 5.1 and `L186` is level 6.2. A capability declaration writes the same levels as 51 and 62. [ITU-T H.265, Annex A.4.1](https://www.itu.int/rec/T-REC-H.265-202601-I/en), [WebKit's HEVC codec-string parser, lines 180-197](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/HEVCUtilities.cpp#L180-L197)

## WebKit on Apple platforms

- `decodingInfo` first asks the media engines whether they support the type. It then parses an HEVC question and calls `validateHEVCParameters`. [Dispatch, lines 80-104](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/cocoa/PlatformMediaEngineConfigurationFactoryCocoa.cpp#L80-L104)
- `validateHEVCParameters` checks the profile against VideoToolbox. It compares the requested level with the decoder's `MaxDecodeLevel`, and it derives the smooth answer from `MaxPlaybackLevel`. Its caller passes no width, height, frame rate or bitrate to it. [HEVC validation, lines 50-130](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/cocoa/HEVCUtilitiesCocoa.mm#L50-L130)
- For a `media-source` question, that earlier type check hands the type to Apple's `AVStreamDataParser`. WebKit does not contain that parser's code. [Media-source check, lines 207-222](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/avfoundation/objc/MediaPlayerPrivateMediaSourceAVFObjC.mm#L207-L222), [parser choice, lines 43-49](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/cocoa/SourceBufferParser.cpp#L43-L49), [MIME delegation, lines 204-213](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/avfoundation/objc/SourceBufferParserAVFObjC.mm#L204-L213)
- For a `file` question, that earlier type check goes to `AVAssetMIMETypeCache` instead. [File check, lines 2112-2124](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/avfoundation/objc/MediaPlayerPrivateAVFoundationObjC.mm#L2112-L2124)
- The comparison with `MaxDecodeLevel` runs only when VideoToolbox's capability dictionary contains that key. Without the key, any level passes. The source does not show which systems leave the key out. [HEVC validation, lines 113-128](https://github.com/WebKit/WebKit/blob/c46f252a2c4246a5a5cda58ce4ba7aed237bf1c6/Source/WebCore/platform/graphics/cocoa/HEVCUtilitiesCocoa.mm#L113-L128)
- An answer starts out not smooth, and only `MaxPlaybackLevel` can make it smooth. Without `MaxPlaybackLevel`, the answer is never smooth. [Default answer, lines 33-35](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/mediacapabilities/PlatformMediaCapabilitiesInfo.h#L33-L35), [HEVC validation, lines 107-128](https://github.com/WebKit/WebKit/blob/45fea774f101adb1e29ec2b8d88b0584c5ec5610/Source/WebCore/platform/graphics/cocoa/HEVCUtilitiesCocoa.mm#L107-L128)
- WebKit's HEVC codec-string parser accepts any `general_level_idc` from 0 to 255 and keeps no list of valid levels. A `general_level_idc` above 255, or a non-number, fails to parse. A refusal of a level from 0 to 255 therefore never comes from the parser. [HEVC codec-string parser, lines 186-197](https://github.com/WebKit/WebKit/blob/c46f252a2c4246a5a5cda58ce4ba7aed237bf1c6/Source/WebCore/platform/graphics/HEVCUtilities.cpp#L186-L197)

## WebKit's GStreamer port

WebKitGTK and WPE run on Linux and answer `decodingInfo` through GStreamer. Nothing on that path reads the level of an HEVC question.

- `isHEVCCodecSupported` checks the profile, then asks whether any decoder handles plain `video/x-h265`. [HEVC support, lines 810-824](https://github.com/WebKit/WebKit/blob/c46f252a2c4246a5a5cda58ce4ba7aed237bf1c6/Source/WebCore/platform/graphics/gstreamer/GStreamerRegistryScanner.cpp#L810-L824), [decoder lookup, lines 996-1011](https://github.com/WebKit/WebKit/blob/c46f252a2c4246a5a5cda58ce4ba7aed237bf1c6/Source/WebCore/platform/graphics/gstreamer/GStreamerRegistryScanner.cpp#L996-L1011)
- For HEVC Main and Main 10, the profile check reads only the profile space and the profile IDC. For a profile IDC of 4 or more, it also reads the constraint flags. [HEVC profile parser, lines 115-146](https://github.com/WebKit/WebKit/blob/c46f252a2c4246a5a5cda58ce4ba7aed237bf1c6/Source/WebCore/platform/gstreamer/GStreamerCodecUtilities.cpp#L115-L146)
- With such a decoder, an HEVC question answers supported and smooth at every level. The answer is power-efficient only for a hardware decoder. [Answer, lines 1173-1180](https://github.com/WebKit/WebKit/blob/c46f252a2c4246a5a5cda58ce4ba7aed237bf1c6/Source/WebCore/platform/graphics/gstreamer/GStreamerRegistryScanner.cpp#L1173-L1180), [GStreamer `decodingInfo`, lines 58-62](https://github.com/WebKit/WebKit/blob/c46f252a2c4246a5a5cda58ce4ba7aed237bf1c6/Source/WebCore/platform/graphics/gstreamer/PlatformMediaEngineConfigurationFactoryGStreamer.cpp#L58-L62)
- For an H.264 question, the same port puts the level into the caps that a decoder must accept. [H.264 support, lines 1013-1054](https://github.com/WebKit/WebKit/blob/c46f252a2c4246a5a5cda58ce4ba7aed237bf1c6/Source/WebCore/platform/graphics/gstreamer/GStreamerRegistryScanner.cpp#L1013-L1054)

A smooth answer from this port gives no evidence about an HEVC level.

## Chromium

- Chromium's HEVC support check reads the colour space and whether the profile is available. The check does not read the requested level. [HEVC support, lines 232-252](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/media/base/supported_types.cc#L232-L252)
- MIME support and `decodingInfo` both go through that support check. A media client answers first, and in Chrome it defers to that check. [MIME support, lines 979-984](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/media/base/mime_util_internal.cc#L979-L984), [`decodingInfo`, lines 1054-1055](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/third_party/blink/renderer/modules/media_capabilities/media_capabilities.cc#L1054-L1055) and [lines 712-749](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/third_party/blink/renderer/modules/media_capabilities/media_capabilities.cc#L712-L749), [dispatch, lines 448-451](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/media/base/supported_types.cc#L448-L451) and [lines 463-490](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/media/base/supported_types.cc#L463-L490), [renderer media client, lines 71-73](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/content/renderer/media/render_media_client.cc#L71-L73) and [lines 162-186](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/content/renderer/media/render_media_client.cc#L162-L186), [default renderer client, lines 212-216](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/content/public/renderer/content_renderer_client.cc#L212-L216), [Chrome's renderer client, lines 85-287](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/chrome/renderer/chrome_content_renderer_client.h#L85-L287)
- For clear content, the performance prediction behind `decodingInfo` reads the profile, the picture size and the frame rate. [MediaCapabilities, lines 1409-1538](https://github.com/chromium/chromium/blob/965715222a942389bd39b8eb6adb5c6bfd5a8a72/third_party/blink/renderer/modules/media_capabilities/media_capabilities.cc#L1409-L1538)

The linked Chromium code therefore gives no evidence about a level.

## What Safari 26.6 on macOS answered

The questions went to Safari 26.6 on macOS through `safaridriver` on 2026-11-11.

- `decodingInfo` was asked about HEVC Main and HEVC Main 10. At level 6.2 the codec strings were `hvc1.1.6.L186.B0` and `hvc1.2.4.L186.B0`. Each question was asked as `media-source` and as `file`.
- HEVC Main was asked in SDR only. HEVC Main 10 was asked in SDR, with PQ colour fields and with HLG colour fields. The PQ fields were `colorGamut: 'rec2020'`, `transferFunction: 'pq'` and `hdrMetadataType: 'smpteSt2086'`. The HLG fields were `colorGamut: 'rec2020'` and `transferFunction: 'hlg'`.
- Each picture was asked at these levels:
  - 1280×720 at 30 fps and 5 Mbit/s: 3.1, 4.0, 4.1, 5.0, 5.1, 5.2, 6.0, 6.1, 6.2, 6.3, 6.5, 7.0 and 8.5.
  - 3840×2160 at 60 fps and 40 Mbit/s: 3.1, 4.0, 4.1, 5.0, 5.1, 5.2, 6.0, 6.1 and 6.2.
  - 7680×4320 at 120 fps and 240 Mbit/s: 5.1, 6.2, 6.3, 6.5, 7.0 and 8.5.
- Safari answered supported, smooth and power-efficient at each level that it was asked from 3.1 to 6.2. Safari answered not supported at levels 6.3, 6.5, 7.0 and 8.5.
- The picture changed no answer. At each level, every picture that was asked at that level got the same answer.
- `HTMLMediaElement.canPlayType` answered `probably` and `MediaSource.isTypeSupported` answered `true` for `hvc1` at levels 5.1 to 6.2. Both refused level 6.3.
- One run of 144 questions, at levels 3.1 to 6.2, took about 1.07 s when asked one after another, and about 0.98 s when asked all at once. Each question took about 7 ms, and questions asked at the same time finished no sooner. A refused question took less time: a second run of 96 questions, at levels 5.1 to 8.5 with two in three of them refused, took about 0.26 s when asked one after another.

The answers agree with the WebKit source: the level decides the answer, and the picture does not. A smooth Safari answer at a level is therefore evidence about that level, in the sense of ADR 0049.

## Asking about level 8.5 first

Level 8.5 is `L255`, the highest level that an HEVC codec string can carry. Safari 26.6 on macOS refused each level 8.5 question that it was asked: HEVC Main in SDR, and HEVC Main 10 in SDR, PQ and HLG, as `media-source` and as `file`, at 1280×720 at 30 fps and at 7680×4320 at 120 fps. A browser that reads no level, such as WebKit's GStreamer port with an HEVC decoder, answers level 8.5 as it answers every other level. The web client therefore asks about level 8.5 before it asks about any level above the needed level. It asks about those levels only after the browser refuses level 8.5.
