# MR-11 checkpoint: staging and operational readiness

Verified: 2026-09-13

MR-11 adds timeout-bounded, HTTPS-validated provider configuration; scoped
identity and observability templates; a guarded, plan-only-by-default staging
drill harness; operational dashboards and alert rules; outage, rotation, replay,
rollback, and incident runbooks; and a value-redacting current/history secret
audit. All external publication, alerts, and drills remain disabled by default.

No provider was selected, provisioned, or contacted. No infrastructure fault was
injected, traveler contacted, booking made, payment attempted, credential rotated,
or Git history rewritten. The drill declares these side-effect boundaries in its
machine-readable report and requires three execution guards.

The repository audit confirmed a tracked historical private-key-shaped file;
the exact path, introduction commit, and authorized remediation sequence are in
`docs/SECRET_REMEDIATION.md`. Values are never emitted.

## Verification

- Focused operational tests: 55 passed.
- TypeScript build: passed.
- Static migration validation: passed (30 tables and 32 required indexes).
- Guarded drill default plan: passed; no scenarios executed.
- Full suite: 944 passed; 5 Redis-dependent tests failed because Redis was
  unavailable, and the Postgres repository suite could not initialize because
  Postgres was unavailable.
- Safe current/history audit: completed with values suppressed. It found one
  current risk path, one additional history-only risk path, and two documented
  placeholder-template paths.

## MR-12 boundary

MR-12 is the environment-specific rollout: choose the staff and alert providers,
provision secrets and scoped identities, inject the staging harness, run the real
migrated fault drill, rotate the legacy credential, coordinate authorized history
cleanup, and capture production approval evidence. It must remain separate from
booking and payment transaction development.
