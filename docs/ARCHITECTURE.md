# Current architecture

## Request flow

```text
WhatsApp user
  -> Twilio / OpenWA / Meta webhook
  -> normalized inbound message
  -> ConversationControlPlane
  -> authoritative active-flow snapshot
  -> bounded ContextBuilder
  -> deterministic analysis plus optional validated LLM interpretation
  -> service-specific form/intake/session flow
  -> external provider boundary
  -> normalized and ranked results
  -> session persistence and pagination
  -> provider-specific WhatsApp delivery
```

## Major boundaries

| Responsibility | Current area |
|---|---|
| Express composition | `src/app.ts` |
| Provider transport gateways | `src/routes/twilioWhatsAppWebhook.ts`, `src/routes/openWaWebhook.ts`, `src/routes/metaWhatsAppWebhook.ts` |
| Conversation control plane | `src/orchestration/ConversationControlPlane.ts` and `src/orchestration/Orchestrator.ts` |
| Active workflow selection | `src/orchestration/ActiveConversationStateLoader.ts` |
| Allow-listed workflow dispatch | `src/orchestration/WorkflowExecutorRegistry.ts` |
| Legacy vertical execution migration boundary | `src/routes/webhook.ts` |
| OpenWA and Meta adapters | `src/routes/openWaWebhook.ts`, `src/routes/metaWhatsAppWebhook.ts` |
| Collection forms | `src/routes/forms.ts` |
| Orchestration | `src/orchestration/` and legacy services under `src/services/` |
| LLM decisions/UI wording | `src/services/LLMService.ts` |
| Hotel intake | `src/services/HotelIntakeService.ts` |
| Hotel execution/ranking | `src/services/HotelSearchFlowService.ts` |
| Google hotel discovery | `src/services/GooglePlacesHotelBrowsingService.ts` |
| Provider adapter prototypes | `src/services/adapters/` |
| Search session state | `src/services/*SearchSessionService.ts` |
| Durable flow repositories | `src/storage/` |
| WhatsApp rendering/outbound | `src/services/WhatsAppRenderer.ts` and provider outbound services |

## AI boundary

AI is used for intent/parameter interpretation and safe user-facing language.
Deterministic code validates required fields, selects a flow, executes provider
calls, ranks/paginates results, stores state, and controls booking/payment gates.

An LLM response is never proof of inventory, price, successful booking, or
payment. Those claims require authoritative provider responses and persisted
transaction state.

Live general intent interpretation is adapted through
`src/orchestration/LLMDecisionInterpreter.ts`. It receives the bounded context
package, allow-lists schema fields, and rejects unknown intents or attempted
transaction-state fields before `DecisionEngine` determines an action.

The migration is incomplete. Active restaurant and excursion continuations are
now selected through the allow-listed `WorkflowExecutorRegistry`, using the
Orchestrator's target flow and active-session decision. Their existing vertical
handlers, the other workflow handlers, form gates, and result-card composition
still live in `src/routes/webhook.ts`. Those implementations must move behind
workflow executors and renderer components without replacing the existing tested
session, provider, and outbound services.

## Current hotel flow

```text
hotel intent
  -> profile gate
  -> hotel form or conversational intake
  -> HotelSearchCriteria
  -> HotelSearchFlowService
     -> configured Nango/tool path (not production-ready), or
     -> Google Places text search fallback
  -> local weighted ranking
  -> up to nine saved results
  -> three results per WhatsApp page
  -> details/select command
  -> booking_provider_pending
```

Current saved hotel results use the Google Places browse shape. This shape must
be generalized before live room/rate results can safely participate in selection.

## WhatsApp providers

`WHATSAPP_PROVIDER` selects Twilio, OpenWA, or Meta. Runtime validation should
require only the chosen provider's credentials. Search/background delivery must
continue using the provider that owns the active conversation.

## Storage

- Active state: Redis through `StateStore`, with supported in-memory fallback.
- Durable profile and service request/session records: Postgres repositories.
- Search sessions: criteria, result batches, selection snapshots, state/stage,
  offsets, timestamps, and expiry.

Provider integration must preserve identifiers needed for details, rate recheck,
booking, cancellation, and audit without exposing those identifiers to users.
