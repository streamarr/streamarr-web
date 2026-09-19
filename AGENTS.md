# Streamarr Web - Project Guidelines

## Commands
- Use the Node major in `.nvmrc` (24.x): `nvm use`. `.npmrc` sets `engine-strict=true`, so `npm ci` refuses a Node or npm older than the `engines` in `package.json`.
- `npm run dev` — Vite dev server; proxies `/graphql` and `/api` to streamarr-server on `localhost:8080` (start it per "Local server" in the server's `AGENTS.md`). Point elsewhere with `STREAMARR_API_TARGET=http://10.0.0.5:8080 npm run dev`. Safari needs the server's `AUTH_COOKIES_ALLOW_INSECURE=true` — see the [README](README.md)
- `npm test` — unit tests (Vitest)
- One unit test file: `npx vitest run src/sw/decisions.test.ts`; add `-t shouldInterceptGraphqlFetch` for one test. One browser spec: `npx playwright test e2e/session-renewal.spec.ts`
- `npm run test:watch` — unit tests in watch mode
- `npm run test:coverage` — unit tests with coverage; the session-renewal core is gated at 95% per file, and the run writes `coverage/lcov.info` for SonarCloud
- `npm run test:e2e` — browser suite (Playwright drives vite dev against the API stub in `e2e/`). Run `npx playwright install chromium` once, and again after a Playwright upgrade
- `npm run format` — Prettier; format before committing. `npm run format:check` is the CI gate
- `npm run lint` — ESLint: type-checked typescript-eslint and React Hooks rules (`eslint.config.js`)
- `npm run typecheck` — TypeScript, no emit, for both the app and the `tsconfig.e2e.json` project
- `npm run build` — production bundle (Vite)
- `npm run schema:pull` — refresh `src/graphql/schema/` (the server's `.graphqls` files + `PROVENANCE`) from the pinned server commit
- `npm run openapi:pull` — refresh `src/api/openapi.json` (the server's OpenAPI document) from the same pinned commit
- `npm run codegen` — regenerate `src/graphql/generated/` from the schema and `.graphql` documents, and `src/api/generated/` from the OpenAPI document
- `npm run codegen:check` — CI drift gate: pull both, generate, then fail on any diff or untracked output
- `npm run tokens` — refresh `src/styles/tokens.generated.css` from streamarr-ux (needs `gh` auth for the private repo)
- `npm run tokens:check` — CI drift gate: fail if the committed tokens differ from streamarr-ux
- `TOKENS_REF` pins the streamarr-ux commit the tokens come from; `npm run tokens` is the only way
  `src/styles/tokens.generated.css` changes — never edit it by hand
- CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `typecheck`, `test:coverage`, `codegen:check`, `build`, the SonarCloud analysis, `test:e2e`, then `tokens:check`

## Engineering Philosophy

### Pre-production Compatibility
- Streamarr has no production instances. Breaking changes are acceptable during this period.
- The server owns the GraphQL and REST contracts. When one changes, move the pin in `src/graphql/schema.pin.json`, regenerate, and update the client in place. Do not keep fallbacks or adapters for a retired contract shape solely to preserve pre-production contracts.
- Establish supported-client compatibility requirements before production deployments begin.

### TDD: Red-Green-Refactor
- Write a failing test FIRST (RED)
- Write the minimum code to make it pass (GREEN)
- Refactor with confidence (REFACTOR)
- Every feature and bug fix starts with a test
- When fixing a defect: first write an API-level failing test, then write the smallest test that replicates the problem, then get both to pass
- Refactor only when tests are green — never refactor while red
- Use the simplest solution that could possibly work

### Root Cause First
- Before fixing a bug, reproduce it and explain the mechanism. A fix that adds a retry, sleep, widened timeout, defensive check, or call-site special case without a stated mechanism is a symptom patch, not a fix.
- If the mechanism lives in a lower layer, fix it there rather than working around it in the caller — correct behavior becomes dependent on the workaround and the underlying bug remains hidden from the next caller.
- Dismissing an intermittent failure as unrelated to the implementation requires evidence; assume an intermittent failure is a real race until proven otherwise — single-thread happy paths hide races, concurrency tests surface them.
- State the root cause in the PR description so reviewers can check the diagnosis, not just the patch.

### Tidy First (Kent Beck)
- Separate all changes into two types:
    1. STRUCTURAL: Rearranging code without changing behavior (renaming, extracting methods, moving code)
    2. BEHAVIORAL: Adding or modifying actual functionality
- Never mix structural and behavioral changes in the same commit
- Always make structural changes first when both are needed
- Validate structural changes don't alter behavior by running tests before and after

### Commit Discipline
- Only commit when ALL tests pass and ALL warnings are resolved
- Each commit is a single logical unit of work
- Commit subjects start with the lowercase prefix `structural:` or `behavioral:` (e.g. `structural: vendor the server SDL as individual .graphqls files`); streamarr-server and streamarr-transcode-worker use the same lowercase prefixes — streamarr-apple uses `STRUCTURAL:`/`BEHAVIORAL:`
- Small, frequent commits over large, infrequent ones
- Commit messages must be under 200 words
- Always use signed commits (`git commit -S`)
- Keep GitHub stacked PR branches linear by rebasing dependent branches onto their updated bases. Put review fixes in ordinary commits; changes made only inside merge commits can be lost when GitHub automatically rebases the remaining stack after a merge.
- NEVER include Co-Authored-By trailers, "Generated by", "Authored by", or any AI attribution bylines in commits, PRs, issues, or any other artifacts
- Eliminate duplication ruthlessly; express intent through naming and structure

### SonarCloud Quality Gate
All PRs must pass these conditions on new code:
- **Coverage** ≥80% (aim for 90%) — write tests for new code
- **Duplicated Lines** ≤5% — extract shared logic, don't copy-paste
- **Maintainability Rating** A — no code smells
- **Reliability Rating** A — no bugs
- **Security Rating** A — no vulnerabilities
- **Security Hotspots Reviewed** 100% — review all flagged hotspots
- **New Lines** ≤2,000 — aim for ≤1,500 to leave buffer for test coverage

### Flat Control Flow
- Use early returns and guard clauses — avoid else/else-if chains
- No nested conditionals — extract to well-named functions or use early exits
- Route on a discriminated union (`result.kind`, `phase.at`) with one guarded return per member
- One level of control-flow nesting inside a function is ideal; two is acceptable; three means refactor

### Concurrency Coordination

Choose the simplest mechanism that fits the operation:

- **Single flight for shared work**: one service worker serves every tab of the origin, so its one
  in-flight refresh (`SingleFlight` in `src/sw/decisions.ts`) is the cross-tab refresh lock;
  concurrent callers await the same promise. `createSessionStore` shares one in-flight session probe
  the same way. Only the service worker posts to `/api/auth/refresh` — don't add a second renewal
  path beside it.
- **Fence stale work by generation**: `createSessionRenewal` and `createRenewalScheduler` bump a
  `generation` counter whenever a session is adopted or cleared. A continuation compares the
  generation it captured and drops its result when they differ, so a refresh already in flight can
  never undo a sign-out.
- **Bound every wait that may never settle**: `navigator.serviceWorker.ready` never resolves when no
  registration matches the page, and a browser can kill a worker mid-request. Discovery and reply
  channels carry their own deadlines (`createRenewalBridge`, `createRenewalSharedWorkerHost`), and
  an expired wait resolves to `{ kind: 'unavailable' }` rather than rejecting.
- **Retry once, and only what is replayable**: a CSRF rejection re-reads the re-minted cookie and
  retries exactly once (`request` in `src/api/http.ts`, `csrfRetryAttempted` in the Apollo error
  link); the service worker clones a request before sending it so one replay can follow a renewal.
- **Correctness never rests on a worker**: browsers kill idle workers and a first visit precedes
  registration. The server's rotation grace window keeps a workerless tab correct; workers only
  smooth timing ([ADR 0016](https://github.com/streamarr/streamarr-adr/blob/main/adr/0016-authentication-mechanisms-and-session-security.adoc)).
  Worker state is volatile — a restarted service worker relearns the CSRF token from the next
  intercepted request.
- **Effects cancel**: a `useEffect` that starts async work sets a `cancelled` flag in its cleanup and
  checks it before touching state (`Player`).

**Anti-pattern:** reading session state, awaiting, then acting on what was read is a check-then-act
race. Re-check the generation — or the `isCurrent()` callback a caller was handed — after every
`await`, as `onRenewed` does in `installSessionServiceWorker`.

### Defensive Programming
- Fail fast with meaningful errors at system boundaries
- Errors convey intent: `AuthApiError` carries `status`, `code`, `retryAfterSeconds`, and
  `serverMessage` — route on `code`, never on message text
- Narrow by shape whatever the contract does not type: error bodies, `postMessage` data, cookies,
  and everything a worker receives start as `unknown` (`readErrorBody`, `extractAuthContext`,
  `isRenewalResult`). Successful response bodies take their types from the generated contract
- An outage is not a verdict: an indeterminate result stays indeterminate (`probeSession` rejects,
  renewal answers `unavailable`) — never coerce it to "anonymous" and sign the user out

### Secret Handling
- Auth tokens never reach script. Access and refresh tokens are `httpOnly` cookies, and the client
  holds only expiry timestamps and scope. Never put a token, password, or PIN in `localStorage`,
  `sessionStorage`, IndexedDB, the Apollo cache, a URL, or a log
  ([ADR 0016](https://github.com/streamarr/streamarr-adr/blob/main/adr/0016-authentication-mechanisms-and-session-security.adoc)).
- The service worker coordinates renewal timing but never handles the tokens; the cookies ride its
  fetches.
- The CSRF token is script-readable by design (`__Host-XSRF-TOKEN`; the unprefixed name is
  development-only). The page echoes it in `X-XSRF-TOKEN` and hands it to the service worker. It is
  not a session credential.
- Passwords and PINs live in component state for the life of the form and travel in a JSON request
  body.
- Playback URLs carry their own short-lived `?t=` token, so the service worker passes
  `/api/stream/**` through untouched.
- CI credentials (`ORG_SONAR_TOKEN`, `STREAMARR_UX_TOKEN`) live in Actions secrets. Never put one in
  a command argument, source file, or log.

### Code Style
- Prettier enforces formatting (`.prettierrc.json`: no semicolons, single quotes, 100 columns) and fails CI through `npm run format:check`
- ESLint also runs in CI and fails the build (`eslint.config.js`). A disable comment names one rule and states the reason on the line above it
- No manual formatting debates — the formatter is always right
- Vendored and generated files are outside both tools (`.prettierignore`, `globalIgnores`) — never format or lint-fix them
- Comments explain non-obvious contracts or why an implementation must be unusual; they do not
  narrate names, control flow, tests, or duplicate ADR and policy text
- Use TSDoc (`/** */`) only for caller-visible contracts; keep implementation rationale as a concise
  local comment beside the relevant code
- If a comment has to defend fragile code, fix or encode the invariant instead — prefer tests and
  static enforcement over prose that can drift
- Don't add TSDoc/comments to code you didn't change

### TypeScript Language
- `strict`, `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch` are on; `npm run typecheck` is part of CI
- No `any` — the only `any` in the repository is generated. Type unknown input as `unknown` and narrow it
- Model multi-way outcomes as string-literal or tagged unions (`SessionAnswer`, `InterceptDecision`, `RenewalResult`) rather than combinations of flags; no hand-written `enum`s
- Build stateful modules as factory functions that close over their state and take collaborators as one destructured dependencies object — `createSessionRenewal({ fetch, now, onRenewed })` — so tests substitute fakes without module mocks. Classes are the exception (`SingleFlight`, `AuthApiError`)
- Inject browser and worker globals (`fetch`, `now`, a worker `scope`, message ports) instead of reaching for them; the entry shells bind the real ones (`src/main.tsx`, `src/sw/sw.ts`, `src/auth/renewal-worker.ts`, `src/auth/renewalBrowser.ts`)
- Prefer a destructured options object once a function needs more than 2-3 arguments. Fixtures take an overrides object — `meFixture({ scope: 'profile' })`, `profileFixture({ pinConfigured: true })` — never a positional list
- Named exports only; `export default` appears only where a tool requires it (Vite, Vitest, Playwright, and ESLint configs)
- Import types with `import type` or an inline `type` qualifier
- Mark a deliberate fire-and-forget promise with `void`; ESLint rejects a floating promise

## Architecture Rules
- A CSR-only React SPA — no SSR. The client is same-origin by construction: the dev server proxies `/graphql` and `/api` (`vite.config.ts`) and production serves the bundle from the application origin. No CORS, no absolute API URLs, and every request the client originates uses `credentials: 'same-origin'`
- `src/` layout: `routes/` (TanStack Router file routes — guards, search params, navigation), feature folders `auth/`, `identity/`, `pairing/`, `streaming/` (screens and their API calls), `ui/` (shared components), `graphql/` (client, error routing, contract artifacts), `api/` (REST client and contract types), `sw/` (service worker), `styles/`, `test/` (render helpers, MSW server, fixtures)
- `src/routeTree.gen.ts` is generated by the router plugin — never edit it. Route tests sit beside their route and end in `.test.tsx` (`routeFileIgnorePattern` keeps them out of the tree); the index route's test is `-index.test.tsx`
- Apollo has no auth link: cookies and the service worker own the session, and the CSRF echo is the only header the client adds (`src/graphql/client.ts`)
- Only the server knows whether a session exists. Route guards ask `SessionStore.ensure()`, auth flows overwrite the cached answer (`markAuthenticated`, `markAnonymous`), and the Apollo error link turns auth error codes into navigation (`decideAuthRoute`). `EXPIRED_TOKEN` is deliberately not a login code — only the renewal worker acts on it
- The service worker intercepts same-origin `/graphql` and `/api/**` only — never its own `/api/auth/refresh*` calls (recursion) or `/api/stream/**` (`decideIntercept`)
- Worker logic lives in modules that take a scope and dependencies (`installSessionServiceWorker`, `createRenewalSharedWorkerHost`); `src/sw/sw.ts` and `src/auth/renewal-worker.ts` are thin entry shells excluded from coverage. Both build to stable origin-root names (`/sw.js`, `/renewal-worker.js`), and the service worker's scope is `/` in development and production (`decideRegistration`)
- Show the server's words: a refusal displays `serverMessage` or the `MutationError` `message` (`userErrorMessage`). The client falls back to a generic sentence only when the server sent none
- Styling is Mantine plus CSS Modules. Values reference the generated design tokens as CSS custom properties — never copy a token value into `src/theme.ts` or a stylesheet. The theme is dark-first
- Fonts are self-hosted from `public/fonts`. No font or asset CDN: clients must work on an offline LAN, and a CDN would leak every visitor to a third party
- Nothing enforces import direction — these rules are upheld by review and tests

## Server Contract
- The server contract is pinned to an exact streamarr-server commit in `src/graphql/schema.pin.json`;
  the one pin covers both the SDL (`schemaDirectory`) and the REST document (`openapiDocument`,
  the server's `docs/openapi.json`). Bumping it is a deliberate, reviewed change.
- `npm run schema:pull` vendors the server's `.graphqls` files verbatim into `src/graphql/schema/`
  and records the source in `src/graphql/schema/PROVENANCE`; `npm run openapi:pull` vendors the
  OpenAPI document byte-for-byte into `src/api/openapi.json`. Never edit `src/graphql/schema/`,
  `src/api/openapi.json`, `src/graphql/generated/`, or `src/api/generated/` by hand — `npm run codegen`
  is the only way they change.
- REST DTOs are aliases over the generated `paths`/`components` via `src/api/contract.ts`
  (`Schema`, `RequestBody`, `Response2xx`), never hand-written interfaces; where the document is
  wider than the server's behaviour (optional response fields, open enums) the client narrows
  locally and says so.
- Operations live in `.graphql` files next to their feature (or under `src/graphql/operations/`);
  generated types and typed documents come from GraphQL Code Generator and are committed.
- Apollo's `InMemoryCache` is configured with generated `possibleTypes`; treat unknown union and
  enum members as expected input — the server deploys new members only after clients can parse them.
- Every mutation document selects exactly one root mutation field, and every `userErrors`
  selection includes `__typename` and the `MutationError` `message` fallback (enforced by
  `src/graphql/contract.test.ts`).

## Settled Decisions (do not revisit without an ADR)
- Architectural decisions are recorded in the canonical
  [`streamarr/streamarr-adr`](https://github.com/streamarr/streamarr-adr) repository.
  Read the relevant ADR before revisiting a decision,
  and record newly settled decisions there using its `adr/template.adoc` and next available
  repository-wide number.
- **Session security**: `httpOnly` cookies with a double-submit CSRF token, no script-readable token storage, and a service worker that owns renewal without correctness resting on it ([ADR 0016](https://github.com/streamarr/streamarr-adr/blob/main/adr/0016-authentication-mechanisms-and-session-security.adoc)).
- **Delivery protocol**: GraphQL is the data API ([ADR 0002](https://github.com/streamarr/streamarr-adr/blob/main/adr/0002-graphql-over-rest.adoc)). REST exists only where the server's OpenAPI document defines it — authentication and sessions, invitations, device pairing, images, and HLS delivery. Don't add a client-side API layer over either.
- **Mutation errors**: payload `userErrors` read through generated types and `possibleTypes`, from a pinned SDL with a CI drift gate ([ADR 0026](https://github.com/streamarr/streamarr-adr/blob/main/adr/0026-mutation-payloads-and-error-channels.adoc)).
- **Household switching and device linking belong to the web client**: tvOS never shows a Household selector, and the Household is chosen here during linking ([ADR 0024](https://github.com/streamarr/streamarr-adr/blob/main/adr/0024-identity-authority-by-relationship.adoc), [ADR 0021](https://github.com/streamarr/streamarr-adr/blob/main/adr/0021-device-pairing-over-streamarr-transport.adoc)).
- **Design tokens** come from streamarr-ux, pinned by `TOKENS_REF` and vendored by `npm run tokens`.
- **Sonar config** lives in `sonar-project.properties`: this repository has no `pom.xml`, which is where streamarr-server and the transcode worker keep theirs.

## Testing

### Strategy
- Test behavior at the highest public surface — the rendered screen or route: drive it with `user-event`, find elements by role and label, and assert what the user sees and where they land; test inputs → outputs, not internal wiring
- Use the lightest test that proves the behavior:
    - **Pure logic unit tests** for decisions and parsers (`sw/decisions`, `graphql/errorRouting`, `graphql/userErrors`)
    - **Module tests with injected fakes** for stateful logic — a fake `fetch`, `now`, port, or worker scope passed through the dependencies object, with fake timers for schedulers
    - **Component and route tests** (Testing Library + MSW): `renderWithProviders` for a screen, `renderAppAt(path)` for the routed app. MSW fakes the network at the boundary, and `onUnhandledRequest: 'error'` fails any request a test did not declare
    - **Contract tests** (`src/graphql/contract.test.ts`) validate every `.graphql` document against the pinned schema
    - **Browser tests** (Playwright) only for what jsdom cannot prove: service-worker control, renewal and replay, responsive layout. They run against `vite dev` on purpose — service-worker scope and proxy wiring differ from the build — with the API stub in `e2e/stub-server.mjs`

### Hard Rules
- No `vi.mock` of first-party modules — inject the collaborator instead. The one module mock is `hls.js`, which jsdom cannot run
- A `vi.fn()` callback prop or injected collaborator is an output, so asserting its calls asserts the result. Don't spy on internals to assert how a result was produced
- NEVER export a function solely for testing, or test implementation details that would break on refactoring
- Tests never reach a real server: unit tests use MSW and browser tests use the stub
- Browser specs cannot run concurrently — the stub's mode is process-global (`workers: 1`)

### Conventions
- Unit tests: `*.test.ts` / `*.test.tsx` beside the code; browser specs: `e2e/*.spec.ts`
- Import `describe`, `it`, `expect`, and `vi` from `vitest` explicitly; globals are enabled only so Testing Library can register its cleanup
- Wait on conditions with `findBy*`, `waitFor`, or `expect.poll`, and drive time with `vi.useFakeTimers()` — never a bare `setTimeout` sleep or `page.waitForTimeout`
- Test naming: `it('shouldExpectedBehaviorWhenCondition', …)` inside a `describe` named for the unit; Playwright specs and the contract test use plain sentences
- The session-renewal core (`src/auth/renewal{Bridge,Protocol,Scheduler,SharedWorker}.ts`, `src/sw/{decisions,sessionRenewal,worker}.ts`) is held at 95% per file by Vitest; everything else reports to SonarCloud, whose gate applies to new code

## Tech Stack
- Node 24, TypeScript 6, React 19, Vite 8 — exact versions live in `package.json` (Renovate keeps them current; don't pin patch versions here)
- TanStack Router (file-based, code-split), Apollo Client over GraphQL Code Generator's typed documents, `openapi-typescript` for the REST contract
- Mantine with CSS Modules and PostCSS; design tokens from streamarr-ux
- hls.js for playback; a service worker and a shared worker for session renewal
- Vitest, Testing Library, and MSW for unit tests; Playwright for browser tests; ESLint, Prettier, and SonarCloud for static quality
- The client talks to streamarr-server over GraphQL and the REST endpoints in its OpenAPI document, and is served from the application origin.
