# streamarr-web

Browser client for [streamarr-server](https://github.com/streamarr/streamarr-server): a CSR-only React SPA (no SSR).
Authentication and session security follow server ADRs 0015/0016 — httpOnly cookies plus a service worker that owns silent token renewal.

## Development

Requires the server running on :8080 (`docker compose up -d && ./mvnw spring-boot:run`).

```
npm install
npm run dev    # Vite dev server; proxies /graphql and /api to :8080
npm test       # vitest
npm run build  # production bundle
```
