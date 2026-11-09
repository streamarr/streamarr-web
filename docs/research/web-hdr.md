# HDR playback in the web client

Research date: 2026-11-09. This note recommends product policy; it does not establish a new architectural decision or verify HDR output on physical hardware.

## Recommendation

Support HDR as a capability-dependent playback option. Keep HDR10/PQ and HLG, preserve an SDR delivery path, and admit Dolby Vision or HDR10+ only through their own verified capability checks. There is no general hls.js limitation that requires an SDR-only web client.

The useful distinction is between selecting and delivering an HDR stream, decoding that stream, and actually presenting HDR on the connected display. A successful codec probe proves only part of that chain. Physical display validation remains necessary before promising a browser/device combination.

## hls.js capabilities

The repository's `package.json` allows `^1.6.16`; `package-lock.json` resolves **1.7.4**. The tagged upstream README describes fMP4 passthrough into Media Source Extensions and explicitly lists HEVC, AV1, VP9, and Dolby Vision, subject to the runtime's support. Decoding and rendering belong to the browser's HTML video pipeline. Consequently, hls.js cannot add HDR decoding or display support that the browser/OS/device lacks. [hls.js 1.7.4 README](https://github.com/video-dev/hls.js/blob/v1.7.4/README.md)

`videoPreference` can restrict and prioritize `SDR`, `PQ`, and `HLG` variants. Explicit `preferHDR: true` overrides the display preference check, so it should not be set unconditionally. `useMediaCapabilities` enables additional rendition filtering, and the documentation acknowledges that browser answers can be inaccurate. [hls.js 1.7.4 API](https://github.com/video-dev/hls.js/blob/v1.7.4/docs/API.md#videopreference)

The library's MediaCapabilities helper submits the actual video codec, dimensions, bitrate, frame rate, and HDR transfer function using `type: 'media-source'`. Its generated video configuration does not specify `colorGamut` or `hdrMetadataType`; it also treats missing MediaCapabilities as supported. Therefore, hls.js selection is useful but is not sufficient evidence for a stricter application capability declaration. [hls.js 1.7.4 implementation](https://github.com/video-dev/hls.js/blob/v1.7.4/src/utils/mediacapabilities-helper.ts)

## Capability evidence

The W3C HDR explainer requires both display queries and MediaCapabilities queries: the latter describes decoder/rendering capabilities independently of the display. Use the actual playback path (`media-source` for hls.js), precise codec/profile including bit depth, dimensions, bitrate, and frame rate. Probe PQ and HLG separately; for HDR10 also ask about Rec.2020 and SMPTE ST 2086 metadata. A generic HEVC, AV1, or 10-bit decode result must not be upgraded to an HDR claim. [W3C HDR capability explainer](https://github.com/w3c/media-capabilities/blob/main/hdr_explainer.md), [Media Capabilities specification](https://www.w3.org/TR/media-capabilities/#videoconfiguration)

`matchMedia('(dynamic-range: high)').matches` supplies display-capability evidence. The specification explicitly says this does **not** prove that an HDR mode is currently active. `video-dynamic-range` exists for platforms with separate graphics and video planes, such as some TVs. Neither query alone identifies a supported HDR codec or metadata format. [Media Queries Level 5](https://www.w3.org/TR/mediaqueries-5/#dynamic-range)

Recommendation: keep unsupported or unverified combinations on SDR, and validate representative real streams on HDR hardware. Tests that emulate a media query or check declaration fields verify client logic; they cannot establish actual HDR luminance, tone mapping, or metadata rendering.

## Native HLS and advanced formats

Safari is a legitimate HDR target: WebKit announced macOS HDR video playback with Safari 14 and documented the dynamic-range query. Native HLS and hls.js/MSE are distinct delivery paths; support observed through one path should not automatically be declared for the other. This evidence does not require changing Streamarr's existing playback-engine choice. [WebKit Safari 14 announcement](https://webkit.org/blog/11340/new-webkit-features-in-safari-14/#media-enhancements)

Apple's current HLS authoring specification supports HDR10, HLG, and Dolby Vision HEVC in fMP4. HDR streams require accurate `VIDEO-RANGE` signaling, and the bitstream/container must carry appropriate color and metadata information. AV1 is also an allowed video codec. Codec and transfer-function support must be tested together. [Apple HLS authoring specification](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html)

Dolby Vision is not interchangeable with HDR10. Apple's appendix identifies profiles 8.1/10.1 as HDR10-compatible and 8.4/10.4 as HLG-compatible, using a base `CODECS` value and `SUPPLEMENTAL-CODECS` for the enhanced representation. HDR10+ metadata has its own compatibility brand. Playing a compatible base layer does not establish that dynamic metadata was processed. Treat these as separate verified options. [Apple HLS supplemental-codecs appendix](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html#the-supplemental-codecs-attribute)

For Streamarr, the practical policy is **HDR10/PQ and HLG when the selected browser playback path and display provide the required evidence; SDR otherwise**. Keep source preservation, tone mapping, and delivery choices in the server's existing playback planning model. The web client should report its supported capabilities honestly rather than applying a global “web means SDR” rule. A client preference cannot create an SDR variant when the server supplies only HDR.
