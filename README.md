# streamarr-web

Browser client for [streamarr-server](https://github.com/streamarr/streamarr-server): a CSR-only React SPA (no SSR).
Authentication and session security follow server ADRs 0015/0016 — `httpOnly` cookies plus a
service worker that owns silent token renewal.

Server admins can manage libraries through **Profile menu → Server settings**.

## Development

Requires the server running on :8080 (`docker compose up -d && ./mvnw spring-boot:run`).

```
npm install
npm run dev    # Vite dev server; proxies /graphql and /api to :8080
npm test       # vitest
npm run test:coverage # critical session-renewal coverage (95% minimum gate)
npm run lint   # ESLint
npm run format # Prettier; format:check is the CI gate
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

## SonarCloud analysis

CI analyzes `main` and pull requests from this repository after `npm run test:coverage`, using
the LCOV report that run writes. A missing token, failed analysis, or failed quality gate fails
the `build` check. Fork and Dependabot pull requests run the build without SonarCloud
credentials; their code is analyzed after it reaches `main`.

The project is `streamarr_streamarr-web` in the `streamarr` organization, under the same
"Streamarr Default Gate" as the server and the transcode worker. Select GitHub Actions analysis
in SonarCloud (Automatic Analysis cannot import coverage and conflicts with CI analysis) and
grant this repository access to the organization's `ORG_SONAR_TOKEN` Actions secret. Project
settings live in `sonar-project.properties`. Never put the token in a command argument, source
file, or log.
