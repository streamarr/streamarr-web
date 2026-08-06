# Durable session-renewal task list

Status: completed and verified on 2026-08-06.

## Interface and ownership

- The service worker remains the sole owner of refresh execution, cookie-mode refresh requests,
  single-flight coordination, expired-response recovery, and request replay.
- A shared worker owns only the proactive clock while at least one app page is open.
- Pages bridge messages between the two workers and pass only expiry metadata and the
  script-readable CSRF token. Authentication cookies remain `httpOnly`.
- Reactive `EXPIRED_TOKEN` recovery remains the correctness fallback when either worker is
  unavailable or has lost volatile state.

## Behavior checklist

- [x] Persist a refresh result that distinguishes success, terminal authentication rejection, and
  transient failure without exposing token material.
- [x] Parse `accessTokenExpiresAt` from every successful refresh and reject malformed success
  responses as transient failures.
- [x] Refresh before forwarding an intercepted request when the known expiry is inside the renewal
  leeway.
- [x] Refresh and replay once after an intercepted `401 EXPIRED_TOKEN` response.
- [x] Collapse proactive and reactive refresh attempts onto one in-flight refresh.
- [x] Preserve the original authentication response after a terminal refresh rejection.
- [x] Return a non-authentication failure after a transient refresh outage so the page does not
  misclassify an outage as logout.
- [x] Schedule one deadline from the latest expiry and replace any older deadline.
- [x] Re-arm the deadline from each successful refresh response.
- [x] Retry transient refresh failures with bounded exponential backoff and reset the backoff after
  success.
- [x] Stop proactive renewal after terminal rejection or explicit logout.
- [x] Share one proactive clock across tabs and route due work through the service worker.
- [x] Degrade to reactive service-worker recovery when `SharedWorker` is unavailable.
- [x] Reconstruct scheduling after a hard reload through the first successful authenticated
  refresh, without persisting credentials in script-readable storage.
- [x] Build both workers as stable origin-root module entries in production.

## TDD and verification checklist

- [x] Capture the existing test, typecheck, and production-build baseline.
- [x] Implement each behavior as a vertical red-to-green slice.
- [x] Test through the renewal engine, scheduler, and bridge interfaces; mock only time, browser
  messaging, and network boundaries.
- [x] Keep branch, function, line, and statement coverage for the critical renewal modules at or
  above 95%, targeting 100% where practical.
- [x] Run the full test suite, typecheck, production build, and critical coverage gate.
- [x] Update this checklist and README architecture summary after verification.

## Deliberate non-goals

- Store or expose access or refresh token values in JavaScript.
- Make proactive timers a correctness requirement.
- Refresh after every fixed interval regardless of the server-provided expiry.
- Keep a session alive after all Streamarr pages have closed.
