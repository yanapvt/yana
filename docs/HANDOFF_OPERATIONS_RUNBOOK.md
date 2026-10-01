# Handoff operations runbook

1. Confirm the readiness reason, metrics window, deployment version, and affected
   provider without inspecting traveler payloads.
2. Disable queue processing or the affected publication/alert flag if retries are
   growing. Existing leases expire and are recoverable; do not manually edit them.
3. For Postgres outage, stop workers, restore database health, run migrations and
   readiness, then re-enable one worker before scaling. Redis outage does not
   authorize bypassing durable identity or case controls.
4. For provider outage, keep work queued, confirm bounded backoff, and enable only
   an approved fallback. Never mark an event delivered without a receipt.
5. For dead letters, an admin inspects minimal metadata, fixes the cause, and
   replays once through the API. Confirm the audit event and duplicate prevention.
6. For SLA breach, notify the incident lead through the approved internal channel,
   assign an operator, and record only safe IDs. Do not contact the traveler from
   drill or infrastructure tooling.
7. Rotate credentials with overlap; revoke immediately on suspected compromise.
   Roll back application code before rolling back schema, because migration 021 is
   additive. Keep processing disabled until readiness is healthy twice.
8. Record timeline, safe correlation IDs, impact counts, containment, recovery,
   and follow-up. Escalate any booking/payment side effect as a critical incident.
