# MR-12 checkpoint: first-party operator dashboard

Verified: 2026-09-13

MR-12 adds a disabled-by-default, mobile-responsive dashboard over the existing
minimal human-handoff services. A one-time login CSRF challenge exchanges the
operator token for an opaque server-managed session; HttpOnly/SameSite cookies,
mutation CSRF tokens, expiry/revocation rechecks, CSP, no-store responses, safe
logout, role checks, and text-only DOM rendering protect the browser boundary.

Viewers can inspect readiness, aggregate metrics, filtered cursor-paginated case
rows, SLA times, and minimal detail. Operators can self-assign and confirm
resolve/cancel. Admins can inspect and confirm duplicate-safe dead-letter replay.
Safe failures include correlation references without provider errors or secrets.

No booking, payment, external publication, alert delivery, native group, or
traveler-contact capability was enabled or added.

## Verification

- Focused dashboard and handoff tests: 61 passed.
- TypeScript build: passed.
- Static migration validation: passed (30 tables and 32 required indexes).
- Full suite: 950 passed; 5 Redis-dependent tests failed because Redis was
  unavailable, and the Postgres repository suite could not initialize because
  Postgres was unavailable.
- Real staging integration was not attempted because no safe staging connection
  is configured in this workspace.

## MR-13 boundary

MR-13 should add a shared encrypted server-side dashboard session adapter,
corporate SSO or an approved identity provider, persistent login/audit telemetry,
and a real controlled-staging accessibility/browser matrix. It must not expand
into booking or payment transaction work without separate approval.
