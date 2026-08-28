# Streamarr Web - Agent Guidelines

## Commands
- `npm test` — unit tests (Vitest)
- `npm run typecheck` — TypeScript, no emit
- `npm run schema:pull` — refresh `src/graphql/schema.graphql` from the pinned server commit
- `npm run codegen` — regenerate `src/graphql/generated/` from the schema and `.graphql` documents
- `npm run codegen:check` — CI drift gate: pull + generate, then fail on any diff

## Commit discipline
- Commit subjects start with the lowercase prefix `structural:` or `behavioral:` (Kent Beck's
  Tidy First split; this matches streamarr-server — streamarr-apple uses `STRUCTURAL:`/`BEHAVIORAL:`)
- Signed commits (`git commit -S`); no Co-Authored-By or AI attribution trailers
- Never mix structural and behavioral changes in one commit

## GraphQL contract
- The server SDL is pinned to an exact streamarr-server main commit in `src/graphql/schema.pin.json`;
  `npm run schema:pull` fetches and concatenates the schema files in stable name order with a
  provenance header. Never edit `src/graphql/schema.graphql` by hand.
- Operations live in `.graphql` files next to their feature (or under `src/graphql/operations/`);
  generated types and typed documents come from GraphQL Code Generator and are committed.
- Apollo's `InMemoryCache` is configured with generated `possibleTypes`; treat unknown union and
  enum members as expected input — the server deploys new members only after clients can parse them.
- Every mutation document selects exactly one root mutation field, and every `userErrors`
  selection includes `__typename` and the `MutationError` `message` fallback (enforced by
  `src/graphql/contract.test.ts`).
