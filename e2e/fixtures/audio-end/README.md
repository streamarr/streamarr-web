# Copied audio ending inside the final segment

The generator creates all pictures and sound from FFmpeg's `testsrc2` and `sine` sources. It reads no external media. Generated files are ignored by Git.

Set `STREAMARR_WORKER_IMAGE` to the immutable image pinned by the server's `worker-image.env`, then run:

```sh
bash e2e/fixtures/audio-end/generate.sh
npx playwright test -c playwright.audio-end.config.ts --project chromium --project firefox
```

Each source has 18 seconds of synthetic video and 15 seconds of audio. The generator copies it into three six-second HLS segments and verifies that the copied AAC or FLAC packet stream has the same SHA-256 as the source audio. The tests exercise normal playback, seeking to 16 seconds, and starting at 16 seconds. They also check that a resume at or beyond the terminal end finishes without requesting media and can replay from the beginning.

The default Playwright run leaves this suite out, and the suite fails when these generated fixtures are absent. WebKit can be selected explicitly; its media support differs from actual Safari, so a WebKit result alone does not establish Safari behavior.
