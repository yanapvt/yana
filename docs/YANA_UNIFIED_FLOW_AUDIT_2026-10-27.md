# YANA unified flow audit — 2026-10-27

This audit reconciles the unified architecture handoff with the current code.
Code and tests are the source of truth.

| Area | Status | Evidence |
|---|---|---|
| Normalized WhatsApp transport boundary | PARTIAL | Provider gateways normalize and deduplicate before `src/routes/webhook.ts`, but some vertical rendering and execution still remains in that legacy route. |
| Authoritative orchestration and constrained LLM decisions | PARTIAL | `ConversationControlPlane`, `Orchestrator`, `DecisionEngine`, and `LLMDecisionInterpreter` own planning and validate structured model output. Some vertical execution is still outside `WorkflowExecutorRegistry`. |
| Fresh bounded model context | COMPLETE | `ContextBuilder` reloads allowlisted state, history, memories, and current displayed results for each interpretation. |
| Shared live journey lifecycle | COMPLETE for supported vertical sessions | Hotel, restaurant, excursion, logistics, and itinerary sessions persist explicit active/paused lifecycle state. `ActiveConversationStateLoader` selects only an active workflow and projects the others as bounded paused context. |
| Preserve journeys during intent/service switches | COMPLETE | Competing workflows are paused rather than cleared in WhatsApp and form transitions. Criteria and results remain in their durable vertical records. |
| UI/chat reconciliation | PARTIAL | Form submissions use the control plane, canonical validation, a workflow lock, CSRF, and workflow ID/revision checks. Website itinerary edits also use CAS. A fully generic canonical event envelope for every website action is not yet implemented. |
| Redis live state / Postgres durable state | COMPLETE for session continuity | Vertical services commit durable state before publishing cache state and recover from the durable repository after restart. Production still requires the configured Postgres/Redis infrastructure. |
| Idempotency and concurrency | PARTIAL | Inbound delivery claims, hashed form request IDs, per-traveller locks, CAS revisions, and late-search generation guards exist. A single universal event ledger covering every UI and provider callback remains future work. |
| Provider/transaction authority | PARTIAL | Provider results are normalized and LLM output cannot claim booking/payment success. Real supplier availability, booking, and payment confirmation remain dependent on configured provider/sandbox capabilities. |

## Changes made in this pass

- Added durable `active` / `paused` lifecycle status to all supported live journey sessions.
- Replaced destructive cross-service clears with pause operations.
- Made lifecycle selection independent of `updatedAt`, preventing a pause write from taking control of the next message.
- Preserved backward compatibility for sessions saved before lifecycle tracking.
- Reconciled valid forms against their matching active or paused workflow, never against another service's active fields.
- Rejected stale workflow IDs and revisions before applying form data.
- Added focused tests for active selection, paused preservation, form resumption, stale form rejection, and restart continuity.

## Next architectural extraction

Move the remaining service-specific execution and response composition out of
`src/routes/webhook.ts` into registered workflow executors and renderer
components. Do this vertical by vertical with current behavior tests; do not
replace the working provider/session implementations wholesale.
