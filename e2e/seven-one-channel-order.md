# 7.1 channel order

`seven-one-channel-order.spec.ts` plays a synthetic 7.1 stream through hls.js on Media Source
Extensions, with the player's hls.js settings, and reads each decoded channel through a
`ChannelSplitterNode` with one `AnalyserNode` per output. The stream lasts 8 s. In each 1 s window
only one channel carries a tone, in FFmpeg's 7.1 order: front left, front right, centre, LFE, back
left, back right, side left, side right. The LFE tone is 50 Hz; the others are 1 kHz. The spec writes
the stream with FFmpeg when it starts: AAC at 768 kb/s, FLAC, and Opus at 768 kb/s with
`-mapping_family 1`.

A window passes when its tone reaches its own output at least 20 dB above every other output. The
spec reads each window from 0.25 s after it starts to 0.25 s before it ends.

| Result | Meaning |
| --- | --- |
| `passed` | Every window passed. The decoder hands all 8 channels to the audio graph in order. |
| `failed` | At least one window failed: the channels arrive in another order, fewer than 8 arrive, or they are mixed. |
| `not observed` | Every output read silence ([WebKit bug 266922](https://bugs.webkit.org/show_bug.cgi?id=266922)). |
| `did not play` | The stream did not play to its end. |

Only `passed` lets a browser declare 8 channels for that codec, and only when `decodingInfo()` also
confirms 8 channels (streamarr/streamarr-web#29). Every other result keeps the 6-channel cap. The
result shows the order in which the decoder hands channels to the audio graph. It does not show how
the operating system maps the device's channels to speakers.

## Results

The spec fails when its result differs from the last row for the same browser, platform and codec.
Add a row when a result changes, and keep the old rows: the declaration keys an 8-channel entry on
the oldest version that passed. The Linux rows come from the CI runner. The macOS rows come from
macOS 26.6 on Apple silicon.

| Browser | Version | Platform | Codec | Result | Note |
| --- | --- | --- | --- | --- | --- |
| chromium | 156.0.8078.4 | macOS | AAC | passed | |
| chromium | 156.0.8078.4 | macOS | FLAC | passed | |
| chromium | 156.0.8078.4 | macOS | OPUS | passed | |
| chrome | 156.0.8078.80 | macOS | AAC | passed | |
| chrome | 156.0.8078.80 | macOS | FLAC | passed | |
| chrome | 156.0.8078.80 | macOS | OPUS | passed | |
| firefox | 157.0 | macOS | AAC | failed | AAC's own order: centre, front left, front right, side left, side right, back left, back right, LFE. |
| firefox | 157.0 | macOS | FLAC | passed | |
| firefox | 157.0 | macOS | OPUS | passed | |
| webkit | 27.2 | macOS | AAC | not observed | |
| webkit | 27.2 | macOS | FLAC | not observed | |
| webkit | 27.2 | macOS | OPUS | did not play | The audio SourceBuffer rejects the first append. |
