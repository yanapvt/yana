# MR-07 checkpoint: durable human concierge handoff

Verified: 2026-09-13

## Scope

MR-07 adds the disabled-by-default service boundary for handing a rechecked hotel
request to a human concierge. It does not book, charge, or represent discovery
results as live inventory.

The handoff service requires all of the following before creating a case:

- explicit traveler consent to share the minimum stay-request summary;
- a successful authoritative supplier availability/rate recheck;
- an explicit traveler intention to proceed;
- at least one configured delivery path with an adapter that advertises the
  required capability.

Open cases are stored in Postgres with one open case per durable session. Queue
notifications are idempotent by handoff and event type. The active state lock
preserves collected state, and only the matching authorized closure clears it.
Assignment and closure require an injected authorizer. Operator audit events use
case, session, service, actor, and correlation identifiers without including
provider errors, credentials, booking/rate tokens, or the traveler summary.

Native WhatsApp group creation is capability-gated. No current WhatsApp adapter
claims this capability, so the runtime cannot claim that it created a group.
The Postgres notification queue is the supported fallback boundary when enabled.

## Configuration

The variables and safe defaults are documented in `.env.example`:

- `HUMAN_HANDOFF_ENABLED=false`
- `HUMAN_HANDOFF_NATIVE_GROUP_ENABLED=false`
- `HUMAN_HANDOFF_FALLBACK_QUEUE_ENABLED=true`
- `HUMAN_HANDOFF_SLA_MINUTES=30`
- `HUMAN_HANDOFF_QUEUE_NAME=travel-concierge`

Enabling handoff requires a real runtime composition with durable UUID user and
session identities, an authenticated operator authorizer, and a queue consumer.
Phone-scoped hotel-search keys must not be inserted into the UUID foreign-key
columns. That runtime/operator composition is intentionally outside MR-07.

## Verification

- Focused MR-07 tests: 23 passed.
- TypeScript build: passed.
- Static migration validation: passed (29 tables, 28 required indexes).
- Full suite: 909 passed; 5 tests failed because Postgres on
  `localhost:5432` and Redis on `localhost:6379` were unavailable. The failures
  were confined to the existing database repository, Redis connection, and
  Redis-backed deduplication integration tests.

Live Postgres migrations, a queue worker, authenticated operator actions, and
live WhatsApp delivery were not exercised in this local checkpoint.

## Next boundary (MR-08)

Compose the service into the runtime using resolved durable user/session IDs,
add authenticated operator endpoints or workers for assignment and closure,
run SLA escalation on a scheduler, and exercise the migrations and queue
consumer against Postgres. Do not enable the feature before those pieces and
their end-to-end tests are present.
