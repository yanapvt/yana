# First-party operator dashboard

The dashboard is mounted at `/operator` and is disabled by default. It exchanges
an operator access token for an opaque, server-held session. The token is posted
in a form after a one-time login CSRF challenge and is never placed in a URL,
source file, browser storage, or dashboard JavaScript. Session cookies are
HttpOnly, SameSite=Strict, Secure by default, path-scoped, and cleared on logout.

## Controlled staging configuration

1. Apply migrations and provide `HUMAN_HANDOFF_OPERATOR_IDENTITIES_JSON` through
   the staging secret manager. Use short-lived viewer, operator, and admin test
   identities with distinct UUIDs and SHA-256 token hashes.
2. Set `HUMAN_HANDOFF_ENABLED=true` and
   `HUMAN_HANDOFF_DASHBOARD_ENABLED=true`. Leave native groups, staff publication,
   alert delivery, and staging fault execution disabled.
3. Keep `HUMAN_HANDOFF_DASHBOARD_SECURE_COOKIES=true`, terminate TLS at the trusted
   proxy, prevent caching, and restrict `/operator` by the corporate access layer.
4. Start with one application instance. MR-12 sessions are process-local and are
   deliberately invalidated by restart; multi-instance rollout requires the
   server-side shared session adapter scoped for MR-13.
5. Verify viewer read-only behavior, operator self-assignment and confirmed
   closure, admin dead-letter access, expiry/revocation, logout, readiness, and
   correlation-safe error handling using synthetic cases only.

## Operator workflow

Sign in with the separately delivered token. Review readiness and aggregate
metrics, filter and page through minimal case rows, open a case for stay name,
dates, and guest count, then assign it to yourself. Resolve or cancel only after
the confirmation prompt. Admins may inspect minimal dead-letter metadata and
confirm a single replay. Copy the displayed correlation reference—not raw
payloads—when escalating an error. Log out before leaving the device.

If a session expires, an identity is revoked, or the process restarts, sign-in is
required again. Never weaken Secure cookies or CSRF checks to bypass access
problems. Follow `docs/HANDOFF_OPERATIONS_RUNBOOK.md` for outages and rollback.
