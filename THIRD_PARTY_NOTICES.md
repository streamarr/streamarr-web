# Third-Party Notices

This repository ships third-party fonts and icon artwork. The notices below apply only to the identified material. Streamarr's own code and all other project material remain subject to the project license in `LICENSE` unless stated otherwise. No upstream creator or project endorses Streamarr or its use of the material.

The complete license texts ship with the client under `public/licenses/`, so every deployment serves them beside the material they cover. `src/thirdPartyNotices.test.ts` holds each text to its pinned bytes and checks that this file names every one of them.

## Lucide (icons)

The application's icons are Lucide glyphs, imported by name from the `lucide-react` package and rendered through `src/ui/Icon.tsx` as the approved subset in streamarr-ux's `ICONOGRAPHY.md`.

Version: lucide-react 1.47.0, pinned by `package-lock.json`.

Copyright notices retained from the package:

> Copyright (c) 2026 Lucide Icons and Contributors
> Copyright (c) 2013-present Cole Bemis

Source: <https://github.com/lucide-icons/lucide>

License: ISC, together with the MIT notice for the Feather artwork Lucide inherited. The complete text, byte-identical to the package's `LICENSE`, is served at `public/licenses/lucide-ISC.txt`.

Modifications by Streamarr contributors: none. Each glyph keeps its geometry; the client sets only its size, stroke width, and color.

## Space Grotesk (font)

Copyright 2020 The Space Grotesk Project Authors (<https://github.com/floriankarsten/space-grotesk>)

Self-hosted as `public/fonts/SpaceGrotesk.woff2` and declared under its own family name in `src/styles/fonts.css`; Streamarr claims no Reserved Font Name.

License: SIL Open Font License, Version 1.1. The complete text is served at `public/licenses/SpaceGrotesk-OFL.txt`.

## JetBrains Mono (font)

Copyright 2020 The JetBrains Mono Project Authors (<https://github.com/JetBrains/JetBrainsMono>)

Self-hosted as the `public/fonts/JetBrainsMono-*.woff2` weights and declared under its own family name in `src/styles/fonts.css`; Streamarr claims no Reserved Font Name.

License: SIL Open Font License, Version 1.1. The complete text is served at `public/licenses/JetBrainsMono-OFL.txt`.
