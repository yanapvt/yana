# Conversation Orchestrator baseline audit

Date: 2026-10-16

This audit records the implementation observed before the conversation-control
migration and the first migration seam added in the same working tree. Code and
passing tests remain authoritative.

| Area | Baseline | Evidence | Current migration state |
|---|---|---|---|
| Provider webhooks | PARTIAL | `src/routes/openWaWebhook.ts`, `src/routes/metaWhatsAppWebhook.ts`, and the former Twilio route validate, normalize, deduplicate, correlate, and deliver. | Twilio transport is now isolated in `src/routes/twilioWhatsAppWebhook.ts`; OpenWA and Meta remain thin gateways. |
| Conversation control | NEEDS HARDENING | `src/routes/webhook.ts` contained intent routing, five vertical session lookups, state transitions, provider execution, and rendering decisions. | All normalized messages now enter `ConversationControlPlane`; remaining vertical execution must still migrate out of the legacy domain module. |
| Orchestrator | PARTIAL | `src/orchestration/Orchestrator.ts` existed with tests but had no live caller. `src/services/Orchestrator.ts` is a second legacy implementation. | The `src/orchestration` implementation is the selected control plane and is live. The legacy implementation is retained until all callers are reconciled. |
| Context Builder | PARTIAL | `src/orchestration/ContextBuilder.ts` built bounded immutable context, but live LLM decisions bypassed it. | General live interpretation now uses the bounded control-plane context. Ad hoc UI wording and hotel-intake LLM calls remain to migrate. |
| Active state ownership | PARTIAL | Redis-backed vertical sessions and Postgres recovery existed, but no component selected one authoritative active workflow. | `ActiveConversationStateLoader` chooses one latest workflow and exposes its schema, collected fields, missing fields, and awaited field. Atomic concurrency control remains outstanding. |
| Schemas | PARTIAL | `src/services/SchemaEngine.ts`, form schemas, request mappers, and handwritten completeness functions overlapped. | Awaited-field handling is deterministic in the control plane. Full schema registry and transition consolidation remain outstanding. |
| LLM safety | PARTIAL | `LLMService` returned structured output, while callers built separate context packages. | `LLMDecisionInterpreter` validates intent and allow-lists fields; booking/payment status and arbitrary actions are rejected. Remaining LLM callers must be migrated. |
| Tools and providers | PARTIAL | Hotel search uses Tool Registry/MCP/adapters; other vertical flow services call provider services directly. | Unchanged in this checkpoint. |
| Rendering | PARTIAL | Provider outbound adapters exist, but card/result enrichment remains in `src/routes/webhook.ts`. | Unchanged in this checkpoint. Rendering extraction remains required. |
| Hotel transaction | PARTIAL | Search, selection, recheck, PayHere initiation, and guarded LiteAPI sandbox components exist separately. | No claim of a proven real transaction. End-to-end sandbox acceptance remains outstanding. |
| Idempotency/recovery | PARTIAL | Inbound idempotency and durable session recovery tests exist. | Control-plane state selection is covered; per-user serialization/revision checks remain outstanding. |

## Verified request path after checkpoint 2

```text
Provider webhook
  -> signature/rate limit/deduplication
  -> normalized InboundMessage + correlation ID
  -> ConversationControlPlane
  -> ActiveConversationStateLoader
  -> ContextBuilder
  -> ConversationAnalyzer
  -> optional validated LLMDecisionInterpreter
  -> DecisionEngine
  -> existing vertical executor (migration boundary)
  -> existing result rendering and provider delivery
```

## Next implementation priorities

1. Replace remaining flow selection in `src/routes/webhook.ts` with an
   Orchestrator-owned workflow executor registry.
2. Consolidate schema definitions, missing-field calculation, and allowed
   transitions for every vertical.
3. Move result composition into renderer/domain presenter components.
4. Add per-user concurrency/version protection to state mutation.
5. Prove the hotel change-intent/restaurant/return journey and restart recovery.
6. Exercise the real configured LiteAPI and PayHere sandboxes without claiming a
   confirmed booking unless both provider booking and payment evidence exist.
