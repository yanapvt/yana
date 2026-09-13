# MR-09 checkpoint: operator queue and observability

Verified: 2026-09-13

## Traveler impact

There is no new booking or payment capability. A consented hotel handoff remains
a minimal-data request for human review after an authoritative supplier recheck.
Queue retries, worker restarts, and duplicate delivery cannot create additional
open handoff cases or cause YANA to book or charge.

## Operator impact

Human-handoff notification rows now support durable worker ownership, lease
expiry, bounded attempts, exponential retry backoff, completion, and dead-letter
state. PostgreSQL `FOR UPDATE SKIP LOCKED` claiming prevents concurrent workers
from owning the same item. Every acknowledgement checks the lease owner; expired
leases are reclaimable after process restart.

Authenticated operator APIs now provide cursor-paginated case listing, minimal
case detail, aggregate queue/case metrics, readiness, and the staging drill in
addition to assignment, closure, and manual SLA execution. Read operations
require both the Bearer credential and a valid UUID operator identity. List
responses omit traveler summaries; details expose only the already-minimized
stay name, dates, and guest count.

Metrics cover ready, processing, retrying, completed, and dead-letter counts,
oldest ready age, open cases, and SLA breaches. Readiness fails closed when
Postgres is unavailable or configured queue-depth, age, or dead-letter
conditions are breached. Structured logs contain aggregate counts or queue,
handoff, attempt, error-code, and correlation identifiers—never raw handler
errors, provider payloads, credentials, or rate/booking tokens.

## Configuration

External queue processing and the staging drill are independently disabled by
default. MR-09 adds:

- `HUMAN_HANDOFF_QUEUE_PROCESSING_ENABLED=false`
- `HUMAN_HANDOFF_QUEUE_WORKER_ID=yana-handoff-worker`
- `HUMAN_HANDOFF_QUEUE_LEASE_SECONDS=60`
- `HUMAN_HANDOFF_QUEUE_MAX_ATTEMPTS=5`
- `HUMAN_HANDOFF_QUEUE_BACKOFF_SECONDS=30`
- `HUMAN_HANDOFF_QUEUE_POLL_SECONDS=10`
- `HUMAN_HANDOFF_ALERT_QUEUE_DEPTH=100`
- `HUMAN_HANDOFF_ALERT_OLDEST_MINUTES=15`
- `HUMAN_HANDOFF_STAGING_DRILL_ENABLED=false`

The deterministic drill validates the consent, durable-identity, queue,
operator-auth, and safe-close contracts and explicitly reports that neither a
booking nor payment was attempted.

## Verification

- Focused cross-cutting tests: 141 passed.
- TypeScript build: passed.
- Static migration validation: passed (29 tables and 30 required indexes).
- Full suite: 931 passed; 5 infrastructure-dependent tests failed because local
  Postgres (`localhost:5432`) and Redis (`localhost:6379`) were unavailable.
- Final diff and secret-scan results are recorded in the commit handoff report.

Live Postgres lease contention and staging queue consumption require a migrated
Postgres environment. Local infrastructure availability is reported separately;
the deterministic store tests cover lease contention/expiry, restart recovery,
duplicate processing, retry/backoff, poison work, dead letters, redaction,
metrics, readiness, authorization, and pagination without external side effects.

## MR-10 boundary

MR-10 should harden production operations: provision scoped operator identities
instead of the shared bootstrap credential, integrate the internal publication
handler with the chosen staff system, add durable alert delivery and dead-letter
replay controls, and execute a migrated staging load/failover drill. It must not
enable booking or payment without a separate approved booking transaction design.

Implemented in `docs/MR_10_CHECKPOINT.md`.
