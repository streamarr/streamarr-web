# Safari HDR and Dolby Vision

`node e2e/record-safari-hdr.ts` records what real Safari on a Mac reports and plays for three
synthetic HLS streams, through `safaridriver`. Each stream is four seconds of a 720p24 test
pattern in HEVC Main 10 without B-frames, tagged BT.2020, in two 2 s fMP4 segments:

- **HDR10:** PQ, with a mastering display and MaxCLL/MaxFALL. The playlist says `VIDEO-RANGE=PQ`.
- **HLG:** the HLG transfer. The playlist says `VIDEO-RANGE=HLG`.
- **Dolby Vision 8.1:** the HDR10 stream with a generated profile 8.1 RPU in every frame. Like the
  server's Dolby Vision copy, it keeps the `hvc1` sample entry with no Dolby Vision configuration
  record. The playlist names `SUPPLEMENTAL-CODECS="dvh1.08.01/db1p"` and `VIDEO-RANGE=PQ`.

The page asks `decodingInfo()`, both `isTypeSupported` methods and `canPlayType` about each
stream's codecs, with BT.2020 and the stream's transfer in the `decodingInfo()` question. It builds
the web client's declaration with `declarePlaybackCapabilities`. Then it plays each stream muted,
first through hls.js with the player's settings and the declaration's video preference, then in
the element's own HLS player. A stream plays when the element passes 2.5 s, inside the second
segment, without an error. The recorder reads a decoded frame's colour space through `VideoFrame`.
It exits 1 when a stream does not play through hls.js. It needs FFmpeg with libx265, and
`dovi_tool`. streamarr/streamarr-server#395 keeps the measured table that these results fill.

## Results

Safari 26.6.2 (21624.5.1.11.3) on macOS 26.6.2 (25G83), Apple M1 Max, with an Apple Studio
Display; recorded 2026-11-05. Safari reports `(dynamic-range: high)`.

The web client declared an SDR HEVC entry and an HEVC entry with the PQ and HLG compatible bases
and Dolby Vision profiles 5, 8.1 and 8.4 at level 9.

Every platform answer was yes. `decodingInfo()` answered supported, smooth and power efficient
(`Smp`) for `media-source` and for `file`; `MediaSource` and `ManagedMediaSource`
`isTypeSupported` answered `true`; and `canPlayType` answered `probably`. That holds for
`hvc1.2.4.L93.B0` with PQ and with HLG, and for `dvh1.08.01` with PQ.

| Stream | hls.js | Native player |
| --- | --- | --- |
| HDR10 | Played. SourceBuffer `hvc1.2.4.L93.90`, variant PQ, frames PQ with BT.2020 primaries. | Played. Frames PQ with BT.2020 primaries. |
| HLG | Played. SourceBuffer `hvc1.2.4.L93.90`, variant HLG, frames HLG with BT.2020 primaries. | Played. Frames HLG with BT.2020 primaries. |
| Dolby Vision 8.1 | Played. SourceBuffer `hvc1.2.4.L93.90`, variant PQ, frames PQ with BT.2020 primaries. | Played. Frames PQ with BT.2020 primaries. |

- hls.js kept the Dolby Vision variant, whose `SUPPLEMENTAL-CODECS` passed its codec check, and
  opened the SourceBuffer with the base layer's codec from the initialization segment.
- Not measured: whether Safari applies the RPUs on screen. A `VideoFrame` reads the base layer, and
  nobody looked at the display. The HDR display checks of streamarr/streamarr-web#29 confirm it.
