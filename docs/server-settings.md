# Server settings and library administration

The production area implements the selected D3 design inside the normal Streamarr shell.
Enter through **Server settings** in the profile dropdown or `/settings/server/libraries`.
Creation lives at `/settings/server/libraries/new`; `?library=<id>` preserves the selected
library through reloads and browser history. Successful creation stays in settings.

## Scope and server contract

Uses the existing server pin in `src/graphql/schema.pin.json`. Operations live in
`src/admin/libraries/Libraries.graphql`; generated artifacts change only through `npm run codegen`.

- Eligible account sessions may list, create, scan, refresh metadata, and remove libraries.
- Creation supports MOVIE and SERIES with LOCAL storage and TMDB metadata. The server starts
  the first scan automatically. Folder input is text, interpreted on the server.
- `addLibrary` userErrors map to input fields with a form-level fallback for unknown errors.
- Scan/refresh Boolean success acknowledges dispatch; it does not prove job completion.
- Removal always confirms. It removes indexed titles and stops playback; files remain on disk.
- Last scan means the last completed attempt, including failed attempts. No progress or ETA
  is invented. The timestamp is localized and uses system typography.
- No editing until [server #410](https://github.com/streamarr/streamarr-server/issues/410).
- No folder browsing until [server #407](https://github.com/streamarr/streamarr-server/issues/407)
  and [web #30](https://github.com/streamarr/streamarr-web/issues/30).
- Item totals are omitted until [server #409](https://github.com/streamarr/streamarr-server/issues/409)
  supplies a server-computed field. Do not sum alphabet buckets or restore sample totals.

## Module interfaces

| Module | Responsibility |
| --- | --- |
| `admin/access.ts` | Shared presentation policy for account ServerAdmin authority and non-device sessions. Household/profile roles do not confer administration. |
| `admin/ServerSettings.tsx` | Identity check on entry, persistent section rail and child route outlet. Add future sections here without coupling them to library operations. |
| `admin/libraries/useLibraryAdmin.ts` | Typed commands, single-request submission guard, inventory loaded on entry, cache invalidation, and request errors. |
| `admin/libraries/LibraryWorkspace.tsx` | Selection, metadata, grouped actions, inline refresh and confirmed removal. Route owns selected ID; each library owns its transient editor state. |
| `admin/libraries/CreateLibrary.tsx` | Supported configuration inputs, draft preservation, field errors and confirmed-ID callback. |
| `admin/libraries/LibraryStatus.tsx` | D3 status rendering, backed by the shared Lucide mapping. |
| `ui/DestructiveButton.tsx` | Reusable contained red action. Callers obtain confirmation before destructive work. |
| `ui/ConfirmDialog.tsx` | Focus management, explicit confirmation, pending/dismissal rules and inline failure. Callers own execution and close on success. |

Public interfaces document their invariants in JSDoc. The admin gate prevents children from
mounting on denial or an uncertain identity. It is not an authorization substitute: the server
checks live authority and account enablement on every mutation. The normal profile-selection
ceremony remains because library reads require it.

## State and cache behavior

Inventory and identity load on entry. Neither polls or refetches when the window gains focus
or the tab becomes visible. Library status and last-scan changes require a page reload; scan
and metadata-refresh acknowledgements explicitly explain this. GraphQL subscriptions are the
planned follow-up for live updates ([web #32](https://github.com/streamarr/streamarr-web/issues/32),
[server #411](https://github.com/streamarr/streamarr-server/issues/411)) and are not part of this release.
Unknown status values are neutral and disable maintenance; known labels stay exactly HEALTHY,
SCANNING, REFRESHING, and UNHEALTHY. View library remains available during maintenance.

An unsuccessful inventory request is never an empty-server signal. A later failure retains the
last successful inventory for context and disables maintenance until recovery. Home only shows
the first-library CTA after a successful empty-inventory result; regular users get useful copy.

Commands do not optimistically claim a job state or successful deletion. They keep a synchronous
submission guard as well as disabled controls. Confirmed creation/removal synchronize the list
with a one-time refetch and invalidate inactive browsing query fields, including Home and
navigation. These user-triggered changes remain visible without a reload. Scan/refresh commands
do not refetch inventory. A failed load offers an explicit retry; a failed/uncertain operation
tells the user to reload and check current state before retrying. Refetch failure cannot
reclassify a successful mutation as failed. Late responses do not navigate unmounted screens.

## Approved visual behavior

- D3 uses the section rail, library list/detail workspace, and compact glyph-based statuses.
- One page title/count; selected library name beside its media icon; status below, aligned with
  that icon. Metadata displays server folder and last scan.
- View library, Scan library, Refresh metadata and Remove library share Library actions.
- Refresh expands between metadata and actions on the same surface with a 180ms ease-out
  height/opacity transition; reduced motion removes the transition. Controls share a 40px height.
- Cancellation returns focus to its trigger. Selecting another library resets the inline editor.
- Creation and the workspace use the same content width. Both adapt to narrow screens.
- Removal is a contained red action with neutral Cancel, confirmation copy, initial Cancel focus,
  focus return, and retained errors. No CSS selector overrides another component's internals.
- Icons follow `streamarr-ux/ICONOGRAPHY.md`. Component decisions are recorded in the UX server
  settings specification. Existing design tokens are reused; the token pin is unchanged.

The throwaway prototype route, sample identities, simulated jobs and review controls have been
removed from the application. This document preserves the approved decisions.

## Verification

`LibraryAdmin.test.tsx` covers access, validation, draft preservation, unknown states/errors,
mutation acknowledgements, removal failures, inventory outages and selection. Home tests cover
first-run eligibility. `e2e/admin.spec.ts` exercises the actual routes and request documents,
the absence of timer/focus/visibility refreshes, updates after page reload, profile entry,
creation, refresh, confirmation, cache updates, responsive geometry and focus. E2E API responses
are controlled fixtures; they never mutate a personal server.

Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`. A live-server smoke
test should use a disposable media directory with an enabled ServerAdmin account.
