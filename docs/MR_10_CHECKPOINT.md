# MR-10 checkpoint: hardened handoff operations

Verified: 2026-09-13

## Safety and traveler impact

MR-10 adds no booking, payment, or traveler-contact path. Staff publications,
operational alerts, and the staging drill are independently disabled by default.
Published events contain only durable event, handoff, type, and correlation IDs.

## Operator and runtime impact

The shared bootstrap bearer credential is replaced by an environment-supplied
set of operator IDs, SHA-256 token hashes, least-privilege roles, optional expiry,
and revocation state. Multiple active hashes allow rotation without downtime.
Viewer, operator, and admin routes are enforced independently, and mutation
requests must use the authenticated identity as the actor.

The queue worker now targets a provider-neutral staff publication adapter with
idempotency keys. It reports completion only after an adapter returns a receipt;
provider failures retain MR-09 retry, lease, and dead-letter behavior. Durable,
deduplicated operational alerts use bounded exponential retry. Admin-only
dead-letter inspection returns minimal metadata, while replay is atomic,
duplicate-safe, and written to the audit log.

The gated staging drill covers migrated schema validation, concurrent claims,
lease loss, restarts, database and publication failure, bounded retry storms,
fallback, recovery, and duplicate-safe replay. Its response explicitly states
that booking and payment were not attempted.

## Configuration

New variables are documented in `.env.example`. Operator credentials and
provider authentication values remain external secrets; no plaintext values are
committed. Publication, alert delivery, and the drill default to `false`.

## Verification

- Focused handoff tests: 50 passed.
- TypeScript build: passed.
- Static migration validation: passed (30 tables and 32 required indexes).
- Full suite: 939 passed; 5 infrastructure-dependent tests failed because local
  Postgres (`localhost:5432`) and Redis (`localhost:6379`) were unavailable.

The deterministic fault scenarios run without external side effects. A real
migrated-environment load and infrastructure fault-injection run remains an
MR-11 deployment activity because this workstation has no Postgres/Redis staging
services or configured staff/alert providers.

## MR-11 boundary

MR-11 should provision the selected staff and alert providers in a controlled
environment, execute the real migrated staging drill with infrastructure fault
injection, establish operational runbooks and dashboards, and remediate legacy
repository secrets. It must not introduce booking or payment without a separate
approved transaction design.

Implemented in `docs/MR_11_CHECKPOINT.md`.
