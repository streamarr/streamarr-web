# Alphabet rail letter jump: why the web blanks and what tvOS does instead

First note in `docs/research/` (the web repo had no notes convention before this file). Read-only investigation; nothing else was changed.

## Question

Clicking a letter in the web library's alphabet rail blanks the whole screen and re-renders it. tvOS handles the same jump with no visible blank. What does each client do, why does the web flash, and what should the web adopt?

## Sources

| Repo | Commit | Branch |
| --- | --- | --- |
| streamarr-web | `dd5887a` (+ uncommitted working tree, read as-is) | `feat/web-12-detail-pages` |
| streamarr-apple | `8297563` | `feat/fonts-consumption` |
| streamarr-adr | `bf18673` | `adr/0032-db-scheduler` |
| streamarr-ux | `29d6753` | `codex/server-settings-design` |

Installed packages: `@apollo/client` 4.2.11, `@tanstack/react-router` 1.170.27 (`node_modules/*/package.json`).

## Web mechanism (observed)

1. **Tap.** `AlphabetRail` is presentational; a click calls `onSelect(letter)` (streamarr-web `src/media/AlphabetRail.tsx:32`, comment at `:4-5`).
2. **Search param.** `selectLetter` forces `by: 'TITLE', direction: 'ASC', letter` through `onSearchChange` (`src/library/LibraryScreen.tsx:149-155`); the route turns that into `navigate({ to: '/library/$libraryId', params, search: next })` (`src/routes/_authenticated/library.$libraryId.tsx:25-27`), a push navigation.
3. **New query variables.** `filter.startLetter` derives from `search.letter` (`LibraryScreen.tsx:43-46`) and is part of `useQuery`'s variables (`src/library/useLibraryItems.ts:24-26`).
4. **Apollo drops `data` synchronously.** On the render where variables differ, `useQuery` calls `observable.reobserve(...)` and then `getCurrentResult()` *inside the same render* (`node_modules/@apollo/client/react/hooks/useQuery.js:171-196`, gated by `shouldReobserve` at `:201-206`). With the default `cache-first` policy, `getInitialResult` returns `data: undefined, dataState: "empty", loading: true` unless the cache already holds a complete result for the new variables (`node_modules/@apollo/client/core/ObservableQuery.js:215-238`); `networkStatus` becomes `setVariables` (`ObservableQuery.js:990-999`). The old page is preserved only as `previousData` — "the result from the most recent *previous* execution of this query" (`node_modules/@apollo/client/react/hooks/useQuery.d.ts:173-179`; saved at `useQuery.js:192-195`). `notifyOnNetworkStatusChange` defaults to `true` in this version (`useQuery.d.ts:62-69`), which only affects re-render timing, not `data`.
   The app's cache has `possibleTypes` but no `typePolicies`/`keyArgs` (`src/graphql/client.ts:51`), so each `filter` value is its own cache entry: the first visit to a letter is a miss (blank), a revisit is a hit (no blank) — which `useLibraryItems.test.tsx:112` ("returns to the requested letter after revisiting a cached, backfilled page") relies on. *Inference:* that is why the flash can look intermittent.
5. **The hook forwards the gap.** `loading: loading && !data` (`useLibraryItems.ts:177`) is `true` exactly when `data` is `undefined`.
6. **The screen unmounts itself.** `if (loading) return <Center h={200}><Loader /></Center>` (`LibraryScreen.tsx:157-163`) replaces the header (`:180-190`), `FilterBar` (`:192-196`), grid (`:202`) and rail (`:256-262`). Unmounting the grid discards its `scrollTop`, the item refs and observers (`:221-231`), and `useVisibleLetter` recomputes to `null` as elements detach (`src/library/useVisibleLetter.ts:16-21, 40-44`). This is the blank frame.
7. **Landing after the response.** A fresh grid mounts at `scrollTop 0` showing the seek page. `beginLetterJump` sets `centering` (`useLibraryItems.ts:61-70`); `loadPrecedingPageForLetterJump` (`:72-96`) issues `loadPrevious()` — `last: PAGE_SIZE, before: startCursor` with `startLetter` stripped (`:128-161`, `:134-135`) — then records the landing cursor. `getReadyScrollTarget` withholds it until the preceding cursor has rendered (`:167-174`); `scrollToLetterLanding` then calls `element.scrollIntoView({ block: 'start' })` (`LibraryScreen.tsx:117-129`). That is a `useEffect`, so *inference:* there is one painted frame with the prepended rows at the top before the landing row is scrolled back into place, since `overflow-anchor: none` disables native anchoring (`src/library/LibraryScreen.module.css:46`) and `restoreScrollAfterPrepend` (`LibraryScreen.tsx:100-114`) only fires when the top sentinel set `heightBeforePrependRef` (`:87-95`), which a jump does not.
8. **Rail highlight.** `selected={visibleLetter ?? search.letter ?? null}` (`LibraryScreen.tsx:259`); the visible letter is the topmost card in the top 10% band (`useVisibleLetter.ts:4`).
9. **Router.** `scrollRestoration: true` (`src/router.ts:26-31`) with `data-scroll-restoration-id="library-grid"` (`LibraryScreen.tsx:202`). Element positions are restored only when `scroll.restoring` (back/forward); a push sets `scroll.next = resetScroll ?? true` (`node_modules/@tanstack/router-core/dist/esm/router.js:420`), which scrolls the *window* to top and touches elements only via `scrollToTopSelectors` (`.../scroll-restoration.js:116-181`). The router neither restores nor resets the grid on a letter push.
10. **Existing expectations.** `e2e/library.spec.ts:132-163` gates the `before` page, clicks N, expects `N Title 00` in viewport, releases the backfill, expects `J Title 00` attached and N still in viewport, then repeats for T and a cached N. Nothing asserts the grid stays mounted. Unit tests: `src/library/LibraryScreen.test.tsx:470` (scrolls the target, not the prepended items), `useLibraryItems.test.tsx:232` (seek page, one backward fetch, landing recorded), route test `src/routes/_authenticated/-library.$libraryId.test.tsx:117-127` (seeded letter).

## Apple mechanism (observed)

1. **Tap.** `AlphabetRail` is a `ScrollView` of `Button`s calling `onLetterSelected(entry.letter)` (streamarr-apple `tvOS/Views/Library/AlphabetRail.swift:9-23`). Models: `Shared/Models/LetterIndex.swift:1-5`, `Shared/Models/AlphabetLetter.swift:3-17`.
2. **The grid never unmounts.** `LibraryDetailView` shows `ProgressView()` only when `vm.isLoading && vm.items.isEmpty` (`tvOS/Views/Library/LibraryDetailView.swift:14-26`). `jumpToLetter` sets `isLoading = true` but does **not** clear `items` (`Shared/ViewModels/LibraryDetailViewModel.swift:56-66`), so `LibraryContent` stays on screen throughout.
3. **The "fake scroll" is a directional slide of the whole grid, not a scroll and not placeholders.** On tap (`LibraryDetailView.swift:86-127`): guard against a jump in flight (`:91`); `isForward = letter > selectedLetter` and `exitOffset = isForward ? -120 : 120` (`:93-94`); animate `gridOpacity → 0` and `gridOffset → exitOffset` over 0.15 s and *await the completion* (`:99-106`); `await vm.jumpToLetter(letter)` (`:108`); then set `gridOffset = -exitOffset` and animate to `0` with `opacity 1` over 0.2 s (`:120-124`). Forward jumps exit upward and enter from below; backward the reverse. The data swap and offset set happen while opacity is 0. There is no skeleton or placeholder row anywhere in `tvOS/Views/Library`.
4. **Fetch order.** `fetchPage(filter: startLetter, replace: true)` replaces `items` and records `hasPreviousPage`/`startCursor` (`LibraryDetailViewModel.swift:67`, `:206-209`); on failure the selection is rolled back and the old items kept (`:68-72`; test `Tests/ViewModels/LibraryDetailViewModelJumpTests.swift:45-75`). `jumpAnchorID = items.first?.id` (`:74`); if `hasPreviousPage`, `fetchPreviousPage()` is awaited (`:75-77`) — `last: pageSize, before: startCursor`, filter without a letter (`:142-152`) — inserting at index 0 (`:163`). Only then `isLoading = false` (`:78`). So anchor and backfill both land before the grid is revealed (`JumpTests.swift:127-172`: items `[m1, m2, m3, m4]`, anchor `m3`).
5. **Offset.** `LibraryGridView` wraps a `UICollectionView` with a diffable data source (`tvOS/Views/Library/LibraryGridView.swift:34-50, 122-158`). `updateUIView` (`:52-76`) runs `prepareForJump` once per `jumpGeneration` (`:113-120`), applies the snapshot, then `layoutIfNeeded()` + `scrollToItemCentered(..., animated: false)` (`:67-69`, `:78-91`), which sets `contentOffset` so the anchor's centre sits on the viewport midline. `applySnapshot` keeps the first visible surviving item fixed when rows are inserted above it (`:178-204`, `offsetAnchor` at `:218-234`) — the analogue of the web's `restoreScrollAfterPrepend`. `JukeboxFlowLayout.prepare` gives symmetric runways so first-half rows can centre (`tvOS/Views/Library/JukeboxFlowLayout.swift:43-61`) and `targetContentOffset` snaps rows to centre (`:63-109`; `Tests/Library/JukeboxFlowLayoutTests.swift:17, 34, 49`).
6. **Focus.** The rail keeps focus during the rebuild; SwiftUI sets `gridFocused = true` (`LibraryDetailView.swift:111-117`), the grid answers `indexPathForPreferredFocusedView` with the anchor (`LibraryGridView.swift:269-277`), and backward pagination is suppressed until focus lands so the just-prepended page cannot trigger another fetch (`:118`, `:253-267`, `:318-325`).

## Constraints

- **ADR 0023** (streamarr-adr `adr/0023-start-letter-seek-pagination.adoc`): `startLetter` is a seek anchor under TITLE sort (`:23`); backward pages cross the letter boundary and cursor validation ignores the letter (`:28-30`); "the client needs no special letter handling after the first page" (`:41`); continuous browsing across the anchor is a product requirement (`:52`). It "was originally numbered ADR 0018" (`:7`). `adr/0018-live-playback-authority-and-outbound-workers.adoc` is live playback, so the web's "ADR 0018" comments are stale: `LibraryScreen.tsx:41`, `useLibraryItems.ts:134`, `LibraryScreen.test.tsx:244` (so are `LibraryDetailView.swift:84` and `JumpTests.swift:122`).
- **UX principle 7, Absence over dimming** (streamarr-ux `PRINCIPLES.md:36-39`): 7.2 "A control that comes and goes reads as breakage"; 7.3 "A blank page isn't restraint — it's a dead end." The Loader branch removes the filter bar, sort menu and rail, which are capability controls.
- **Principle 12, Humans want to scroll** (`PRINCIPLES.md:70-73`): browse depth is vertical, on web inside sticky-headed containers.
- The rail spec (`mocks/README.md:46`, `mocks/AlphabetRail.dc.html:48-49`) covers cells and selection only; no mock specifies loading behaviour for a jump. tvOS 02a is "one row centred, snaps row to row" (`mocks/README.md:57`).

## Options

**(a) Keep the grid mounted on `previousData`; swap edges on arrival; position the landing row in a layout effect.**
`useLibraryItems` returns edges/library from `data ?? previousData` and reports `loading` only when neither exists; `LibraryScreen`'s Loader branch then fires only on first load. Positioning moves from `useEffect` (`:117-129`) to `useLayoutEffect`: on the seek-page commit set `scrollTop` so the landing row is at the grid top (the old `scrollTop` would otherwise persist, since the router does not touch the element — §9), and on the backfill commit re-pin it before paint, closing the frame in §7. `restoreScrollAfterPrepend` is unaffected (its ref is set only by the sentinel and cleared on filter change, `:80-85`). While the seek is pending the rail should show `search.letter`, not `visibleLetter` from the old rows. Back-navigation restoration keeps working: the keyed element is never replaced. Existing e2e expectations (`:132-163`) hold unchanged. *Inference:* the swap is still a hard cut; the Apple slide can be added later as a CSS transform/opacity transition (honouring `prefers-reduced-motion`) as a separate behavioural commit.

**(b) Skeleton rows for the target page.** Apple does not do this (Apple §3). The page's length and posters are unknown before the response, and 7.1 says an element that represents content exists only while the content does. Rejected.

**(c) Keep the search param as truth, only remove the Loader branch.** The search param is already the source of truth (§2). Removing the branch alone leaves `edges` empty during the wait, which renders "No items match this filter." (`LibraryScreen.tsx:199-200`) — a worse flash. (c) needs (a)'s data continuity to work.

## Recommendation

Adopt **(a)**. It matches what tvOS actually does (data swap under a still-mounted grid, offset set before reveal, backfill awaited before the reveal), honours principles 7 and 12, and uses the field Apollo documents for exactly this (`previousData`). Fix the three stale "ADR 0018" comments to 0023 in a structural commit first.

## Test seams and RED assertions

- **`src/library/useLibraryItems.test.tsx`** (existing test file): gate the `startLetter: 'N'` response; change the filter; assert `edges` still equals the prior page and `loading` is `false` (or a new `jumpPending` flag) until release, then equals the N page.
- **`src/library/LibraryScreen.test.tsx`** (`renderWithProviders` + `Harness`, MSW): hold the grid node (`document.querySelector('.' + styles.grid)`) before clicking `N` with the N response gated; assert `grid.isConnected` stays `true`, the `Movies` heading and `navigation "Jump to letter"` remain, and `N` has `aria-pressed="true"` during the wait; after release assert the same node still holds `Northern Line`.
- **`src/routes/_authenticated/-library.$libraryId.test.tsx`** (`renderAppAt`, `src/test/render.tsx:33-46`): click `N`; assert `router.state.location.search.letter === 'N'` and the grid node identity is unchanged across the navigation.
- **`e2e/library.spec.ts`**: in "a letter jump stays on its target…", take `await grid.elementHandle()` before the click and assert `handle.evaluate((el) => el.isConnected)` after both the seek and the backfill; assert the landing card's `boundingBox().y` equals the grid's top within one row gap after the backfill, and that no frame showed `J Title 00` above it (poll `scrollTop` never drops to 0 after landing). Playwright is the only layer that can prove the positioning, since jsdom has no layout.

## Spike: row virtualization (2026-09-22)

Branch `feat/library-virtual-grid` (spiked as `spike/library-virtual-grid`), worktree `../streamarr-web-virtual-spike`, on top of `feat/web-12-detail-pages` at 5a6a4b3. Question: does virtualizing the grid with TanStack Virtual make a letter jump cheaper without losing the landing, the backfill, Back, the rail, or the phone layouts?

### What was built

- `LibraryGrid` (extracted from `LibraryScreen`) runs `useVirtualizer` over rows: rows are absolutely positioned inside a spacer the height of the list; one rendered row supplies the column count (computed `grid-template-columns`), the row height (bounding rect, ceiled) and the gap (`row-gap`), measured again on a width change. Rows are keyed by their first cursor, so a page prepended in whole rows keeps the visible rows mounted.
- A letter lands by row index from `measurementsCache[row].start`; a prepended page shifts `scrollTop` by the start of the row its old first title moved to, and only within the same result key. The paging sentinels sit at the spacer's ends, so the half-viewport prefetch is unchanged. The rail's letter is the top row's (`virtualizer.range.startIndex`), no per-item observers; when the pressed letter's titles are in that row it wins, as tvOS does through its focused title.
- Cards load posters eagerly (they mount only near the viewport) and `.posterMeta` is one line, so every row is the same height. The React Compiler skips any function that calls `useVirtualizer`, so that call lives in a thin hook and the grid still compiles.
- jsdom needs a viewport: `vitest.setup.ts` reports an `offsetHeight` for the scroll container and a rect for a row. The browser specs scroll by row geometry where a row is not in the DOM yet, and a new spec holds the card count flat across ten jumps.

### Measurements

1,799 titles on the LAN server, Chrome, dev build unless noted, warm cache.

| Scenario | Before | Virtualized |
| --- | --- | --- |
| Jump at 1440×900: request leaves after the press | ~60 ms | 23 ms |
| Jump at 1440×900: grid invisible | ~235 ms | ~95 ms |
| Cards in the DOM after landing and backfill | 96 | 36 (phone 375×667: 12) |
| Back from a title at 1440×900 | restored | restored (4037 → 4037, title in view) |
| Ten jumps, card count | grows per page | flat within one row |

Fast flick of 8,000–9,000 px:

| Viewport, build | Frames with unloaded visible posters | Longest frame | Row mount |
| --- | --- | --- | --- |
| 1440×900 dev, lazy posters | 18 of 89 | 34 ms | – |
| 1440×900 dev, eager posters | 0 | 25 ms | – |
| 1440×900 dev, eager, overscan 4 | 0 | 26 ms | – (+24 cards) |
| 2560×1440 dev (11 columns) | 0 | 42 ms, 18 frames over 20 ms | 13 ms mean, 18 ms max |
| 2560×1440 production | 0 | 19 ms, none over 20 ms | 2.4 ms mean, 5 ms max |

Page size is not what shows blank space on a flick: the viewer never reached the end of the loaded rows (0 frames) and one page request fired. Lazy loading was: a remounted card deferred its poster. At wide windows the dev build's row mounts outrun the compositor; the production build keeps up.

### Costs and open points

- A focused card that scrolls out of the rendered range unmounts, and focus falls to `body`; two rows of overscan keep sequential Tab working.
- Geometry follows the ResizeObserver, so the frame after a width change can lay rows out with the old column count.
- On a reload with `?letter=` and a saved position, the first landing yields to a non-zero `scrollTop`.
- TanStack's `anchorTo: 'end'` anchoring by key does not cover a prepend that reflows rows (48 % columns ≠ 0); the row-index compensation does.
- Dev-mode flicks at wide windows show blank rows. A lighter card while `isScrolling` is the usual mitigation if that matters.

### Verdict

Virtualization pays: the jump's invisible window drops by about 60%, the DOM stays flat as pages accumulate, and the phone layouts, Back and the rail hold. Merge candidate once the focus behaviour has an owner's answer.

## Productionizing the spike (2026-09-22)

The open points above were closed on the same branch, test-first at the agreed seams (`LibraryScreen.test.tsx`, the route test, `e2e/library.spec.ts`).

- **Focus.** The grid follows the WAI-ARIA grid pattern, which agrees with tvOS that focus is the viewer's place and is never lost. The rows are `role="grid"` with `aria-rowcount`, each rendered row carries `aria-rowindex`, and each card sits in a `gridcell`. One tab stop with a roving tabindex: the focused card, else the first card in view; arrow keys move between cards, Home and End along the row, Tab leaves. The focused card's row is added to the virtualizer's range through `rangeExtractor`, so it stays mounted however far the viewer scrolls. A letter chosen from the keyboard (a click with `detail === 0`) moves focus to the landing card, as tvOS focuses the anchor item; a pointer jump leaves focus where it was.
- **Resize.** The grid observes its own size with a `ResizeObserver` and re-measures the geometry inside a `flushSync` render there, before paint. The browser spec registers a second observer after the app's, whose callback therefore sees the rows as the frame will paint them, and finds none overfull or overlapping; before the change it saw four overfull and three overlapping rows. The geometry is taken from a cell, not the row: in that delivery the probe row is still laid out for the old column count, so its cards wrap and its height is that of several rows.
- **Re-keyed rows.** Rows are keyed by their first title, so a new column count, or a page prepended in anything but whole rows, remounts the cards in them. A card unmounted while focused asks to be focused again in its new element, and the effect that fulfils focus requests runs after the effects that place the rows. Found by manual testing on the production build; proven by unit tests for both re-key causes and by the resize spec, which also checks the re-focused card is fully in view.
- **Reload guard.** Removed as unreachable. The router restores an element's position only when the element exists as the route renders; on a reload the grid mounts after the query answers, so a reload lands on the letter or the top, as it did before virtualization. On Back the router's restore runs after the landing effect and wins on its own.
- **Uniform row height.** Stated where the geometry is measured and proven by a browser spec that lengthens one title: no title grows, every row measures the same, rows sit one pitch apart. Dropping the title's one-line rule fails it.
- **Coverage.** `LibraryGrid.tsx` at 95% statements / 87% branches from the unit suite; the remaining lines are the zero-height and no-focus guards.
- **Adversarial review (Codex).** Two keyboard defects, fixed test-first: an arrow key from a row kept mounted only for its focus let the unmount fallback overwrite the pending request, dropping focus to the body; and a navigation key with nowhere to go (Home on a row's first card, End on its last, an arrow at an edge) was left to the browser, which scrolled the grid while focus stayed behind. The grid now owns every navigation key it recognises.

Observed once during manual testing, not reproduced in three further attempts: after a keyboard jump to P, the page before P was requested twice and the grid showed 48 titles for a few seconds before the backfill appeared. Both responses were valid; the cache held the merged page afterwards. Worth watching in the browser suite's jump specs.
