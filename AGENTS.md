# Streamarr Web - Agent Guidelines

## Commands
- `npm run dev` — Vite dev server
- `npm test` — unit tests (Vitest)
- `npm run test:watch` — unit tests in watch mode
- `npm run test:coverage` — unit tests with coverage; the session-renewal core is gated at 95% per file
- `npm run test:e2e` — browser suite (Playwright drives vite dev against the API stub in `e2e/`)
- `npm run typecheck` — TypeScript, no emit, for both the app and the `tsconfig.e2e.json` project
- `npm run build` — production bundle (Vite)
- `npm run schema:pull` — refresh `src/graphql/schema/` (the server's `.graphqls` files + `PROVENANCE`) from the pinned server commit
- `npm run codegen` — regenerate `src/graphql/generated/` from the schema and `.graphql` documents
- `npm run codegen:check` — CI drift gate: pull + generate, then fail on any diff or untracked output
- `npm run tokens` — refresh `src/styles/tokens.generated.css` from streamarr-ux (needs `gh` auth for the private repo)
- `npm run tokens:check` — CI drift gate: fail if the committed tokens differ from streamarr-ux
- `TOKENS_REF` pins the streamarr-ux commit the tokens come from; `npm run tokens` is the only way
  `src/styles/tokens.generated.css` changes — never edit it by hand

## Commit discipline
- Commit subjects start with the lowercase prefix `structural:` or `behavioral:` (Kent Beck's
  Tidy First split; this matches streamarr-server — streamarr-apple uses `STRUCTURAL:`/`BEHAVIORAL:`)
- Signed commits (`git commit -S`); no Co-Authored-By or AI attribution trailers
- Never mix structural and behavioral changes in one commit

## GraphQL contract
- The server SDL is pinned to an exact streamarr-server main commit in `src/graphql/schema.pin.json`;
  `npm run schema:pull` vendors the server's `.graphqls` files verbatim into `src/graphql/schema/`
  and records the source in `src/graphql/schema/PROVENANCE`. Never edit that directory by hand.
- Operations live in `.graphql` files next to their feature (or under `src/graphql/operations/`);
  generated types and typed documents come from GraphQL Code Generator and are committed.
- Apollo's `InMemoryCache` is configured with generated `possibleTypes`; treat unknown union and
  enum members as expected input — the server deploys new members only after clients can parse them.
- Every mutation document selects exactly one root mutation field, and every `userErrors`
  selection includes `__typename` and the `MutationError` `message` fallback (enforced by
  `src/graphql/contract.test.ts`).
