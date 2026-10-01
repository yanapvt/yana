# MR-08 checkpoint: human handoff runtime and operator controls

Verified: 2026-09-13

## Traveler impact

After a selected hotel passes the authoritative supplier recheck, YANA now asks
for a separate, explicit consent message before sharing the minimum request data
with a human concierge. Declining or giving an ambiguous answer does not create
a handoff. An active handoff locks the hotel conversation at its safe boundary;
YANA does not book or charge while an operator handles the case.

The shared summary contains only the selected stay name, travel dates, guest
count, service type, and correlation/durable identity references. Preferences,
provider payloads, rate tokens, credentials, and raw failures are excluded.

## Operator impact

The runtime composes Postgres case storage, the idempotent Postgres notification
queue, durable UUID identity resolution, and the phone-scoped hotel-session lock.
If no current durable session exists for a known user, a new durable session is
created before handoff. Foreign-key UUID columns never receive phone-scoped keys.

Authenticated JSON endpoints support assignment and resolved/cancelled closure:

- `POST /admin/handoffs/:handoffId/assign`
- `POST /admin/handoffs/:handoffId/close`
- `POST /admin/handoffs/sla/run`

They are hidden while the feature is disabled and require a constant-time
Bearer-token check plus UUID actor/operator identifiers. Assignment and closure
are transition-safe and tolerate same-operation replay. API responses omit the
traveler summary.

The process starts an unreferenced SLA interval only when handoff is enabled and
stops it during SIGINT/SIGTERM shutdown. Every cycle reloads overdue open cases
from Postgres, so restart does not lose work. Queue event uniqueness makes retry
delivery idempotent.

## Configuration

MR-08 remains disabled by default. Enabling it also requires:

- `HUMAN_HANDOFF_OPERATOR_TOKEN`
- `HUMAN_HANDOFF_SLA_POLL_SECONDS` (default `60`)
- reachable Postgres with migrations 018 and 019 applied;
- an authenticated worker that consumes scheduled handoff notifications.

No current adapter advertises native WhatsApp group creation.

## Verification

- Focused cross-cutting tests: 144 passed.
- TypeScript build: passed.
- Static migration validation: passed (29 tables and 28 required indexes).
- Full suite: 919 passed; 5 failed because Postgres on `localhost:5432` and
  Redis on `localhost:6379` were unavailable. Failures were limited to the
  existing Postgres repository suite and Redis connection/deduplication tests.

Live migrations, real queue consumption, and live WhatsApp delivery could not be
exercised without local infrastructure and credentials. The feature must remain
disabled until those deployment checks pass.

## MR-09 boundary

The leased operator queue, case views, metrics/readiness, and guarded staging
drill are implemented in MR-09. See `docs/MR_09_CHECKPOINT.md` for the remaining
production identity, alert-delivery, and staging-load boundary.
