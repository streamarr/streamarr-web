# streamarr-web

Browser client for [streamarr-server](https://github.com/streamarr/streamarr-server): a CSR-only React SPA (no SSR).
Authentication and session security follow server ADRs 0015/0016 — `httpOnly` cookies plus a
service worker that owns silent token renewal.

## Session renewal architecture

The two worker types are complementary:

- The service worker is the sole refresh executor. It owns the single-flight refresh request,
  preflights API calls near expiry, and refreshes and replays once after a recoverable access-token
  rejection (`401 EXPIRED_TOKEN` or `401 INVALID_TOKEN`).
- A shared worker owns one proactive deadline for all open tabs. Thirty seconds before the latest
  server-provided expiry it asks a page to route renewal through the service worker, then re-arms
  from the returned expiry. Transient failures use bounded exponential backoff.
- If the shared worker is unavailable, suspended, or restarted, reactive service-worker recovery
  remains the correctness path. A successful authenticated probe reconstructs the proactive clock
  after a hard reload.
- Neither worker stores token values. Authentication cookies remain `httpOnly`; only expiry
  metadata and the script-readable CSRF token cross worker messages.

The durable behavior and verification checklist is in
[`docs/session-renewal-tasks.md`](docs/session-renewal-tasks.md).

## Development

Requires the server running on :8080 (`docker compose up -d && ./mvnw spring-boot:run`).

```
npm install
npm run dev    # Vite dev server; proxies /graphql and /api to :8080
npm test       # vitest
npm run test:coverage # critical session-renewal coverage (95% minimum gate)
npm run build  # production bundle
```

### Pointing at a server elsewhere

The dev proxy defaults to `localhost:8080`. To develop against a server on another
machine — a home box running the packaged image, say — override the target:

```
STREAMARR_API_TARGET=http://10.0.0.5:8080 npm run dev
```

### Safari

Auth cookies are `Secure`, and Safari refuses to store or send those over plain HTTP
even on localhost, so cookie-mode login silently leaves every later request
unauthenticated. Chrome and Firefox treat localhost as a trustworthy origin and work
as-is. To develop in Safari, run the server with `AUTH_COOKIES_ALLOW_INSECURE=true`
under a `dev` or `test` profile.
