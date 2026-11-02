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

### Prompt and context integration (2026-10-21)

`src/orchestration/PromptService.ts` owns the YANA core system instructions and
the purpose contracts `decision`, `hotel-extraction`, and `response`.
`LLMService` sends these instructions in the system role and serialized request
data separately in the user role for OpenAI-compatible providers. The interpreter
forwards the actual Orchestrator-generated prompt instead of discarding it.
Instructions no longer interpolate traveller text or profile values.

The production paths are:

- General interpretation: webhook -> ConversationControlPlane -> Orchestrator ->
  PromptService -> LLMDecisionInterpreter -> LLMService.decide -> HTTP transport.
- Active hotel routing: webhook -> ConversationControlPlane.interpret -> the
  same ContextBuilder, interpreter, DecisionEngine and decision transport.
- Optional hotel extraction: HotelIntakeService -> LLMService.extractHotelCriteria
  -> the dedicated JSON extraction instructions and HTTP transport.
- Response wording: ConversationManager -> its default adapter ->
  LLMService.generateUIContent -> response instructions and HTTP transport.

Language and other allowlisted profile preferences supplied to the interpreter
now reach the model. ConversationManager preserves the supplied profile language.
ContextBuilder retrieves up to twelve durable recent turns through
MessageRepository and produces the one model projection for all these purposes.
It allowlists profile/criteria/results fields, limits turn/string/payload sizes,
redacts credentials/contact details and secure links, and includes workflow
schema/version, session identity/revision, itinerary and result freshness.
ActiveConversationStateLoader reads the authoritative vertical repositories for
planning; Redis remains a cache for execution paths. An unavailable required
context source is distinct from absent data and blocks speculative interpretation.
See `docs/YANA_ARCHITECTURE_IMPLEMENTATION_2026-10-21.md` for verification and scope.

### Typed traveller context (2026-10-26)

`src/orchestration/TravellerMemory.ts` defines the allowlisted profile, trip and
task memory contract. The LLM may propose only explicit, confident facts in its
structured decision; CORE validates those candidates before
`TravellerMemoryRepository` persists them with source-message provenance.
Allergies and accessibility needs remain proposed until confirmed and are
excluded from recommendation context. Companion details and occasions are
always trip scoped.

`ContextBuilder` retrieves these facts independently of vertical workflow state
and projects only confirmed facts relevant to the active service. PostgreSQL is
authoritative; an LLM response or process-local value is never durable memory.

### UI/text reconciliation (2026-10-22)

Every normalized WhatsApp event enters `ConversationControlPlane.plan`. Clear
button/list/card payloads such as `book 2`, `details 1`, and `next` remain
deterministic and do not call the LLM. Ordinal references such as “show me the
second one” are accepted only when that position exists in the latest displayed
persisted batch; the analysis binds both its display position and stable result
ID. Older batches are not projected as the current options.

Free text during an active workflow is interpreted before a legacy vertical
handler can consume it. The interpreter receives a newly loaded active session,
bounded durable history, canonical collected/missing fields, and the latest
displayed result IDs. Valid same-workflow field changes are committed through
`MemoryUpdater` before the workflow executor reloads state, so unrelated valid
criteria survive and stale results are cleared by the session service. Clear
legacy hotel-intake answers continue deterministically without a redundant LLM
call.

Validated service-form submissions call
`ConversationControlPlane.reconcileFormSubmission` under the existing workflow
lock after token, CSRF, and revision checks. CORE merges only canonical fields,
preserves valid criteria from the form's matching active or paused workflow, and
recalculates request-level missing fields. The form's bound workflow ID and
revision must still match, so an old browser tab cannot overwrite a newer
journey version. A valid submission may resume its paused workflow without
borrowing fields from the currently active workflow;
the existing form mapper and vertical session service still own channel mapping
and persistence. Booking forms retain their stricter transaction-specific path.

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

## Canonical validation and semantic UI

`src/orchestration/WorkflowDefinitions.ts` owns version 1.0 canonical service
criteria, aliases and the separate discovery/search versus complete-request
requirements. `SchemaEngine` computes missing fields after Zod value validation.
The existing form Zod schemas and request mappers retain channel input validation
and convert form names to canonical service criteria. Unknown intents become
clarification; invalid structured output, actions, values and dates cannot execute.
DecisionEngine applies the configured confidence threshold, correction checks,
profile gate, clarification and consent-based handoff semantics.

`src/orchestration/SemanticUI.ts` validates semantic modes, schema/form IDs,
prefill, actions, correlation and expected revision. The Orchestrator produces
this decision. Form invitations use its WhatsApp adapter; form pages use its
website adapter and the existing HTML renderer. Forms bind the workflow/profile
revision on GET and preserve token/CSRF checks on POST. Provider-specific cards,
lists and outbound delivery remain in their existing adapters.

## Itinerary editing

`ItineraryEditService` is the shared edit boundary for WhatsApp and the website.
Versioned commands identify trip, expected revision, day, operation and target.
Supported replacement targets are morning, afternoon, evening, hotel planning
text and transport planning text. Explicit natural-language replacements and
"more beach time" with a known day map deterministically to these commands.
Ambiguous/unsupported edits ask for clarification; they are not saved as completed
operations. No edit books or confirms a supplier service.

The service reads the durable itinerary, applies the edit to actual day content,
commits through the existing itinerary repository with CAS, then updates the
workspace projection. Workspace GET resolves its bearer-token hash through the
durable itinerary session, so cache loss does not discard the saved plan or link.
Editor POST requires a matching form/CSRF token and revision; stale edits return
409. Display-only selected-day state remains a cache preference.

## Storage

- Active state: Redis through `StateStore`, with supported in-memory fallback.
- Durable profile and service request/session records: Postgres repositories.
- Search sessions: criteria, result batches, selection snapshots, state/stage,
  offsets, timestamps, and expiry.

Each live vertical session also has an explicit `lifecycleStatus` of `active` or
`paused`. Switching service pauses competing journeys instead of deleting them;
the selected journey becomes active when its normal state transition is saved.
The active-state loader never uses a recently paused workflow merely because its
pause write has the newest timestamp. Records created before this property was
introduced remain backward compatible and are treated as active until explicitly
paused. Lifecycle state and collected criteria are written to the existing
durable session repository, so a process restart does not erase paused journeys.

Durable session writes now check expected numeric revision and trip/session ID
while holding the existing preference-row lock. New JSON properties live in the
existing preference bridge; no SQL migration is required. Cache publication
follows durable commit. Failed durable writes throw a safe PersistenceError;
key save methods return durable/degraded-cache receipts. A failed lookup is not
silently converted to an empty workflow. Profile form revisions are also checked
under the preference lock. Form request IDs are derived from a hashed submission
token for retry idempotency.

Normalized inbound mutations and form submissions additionally share the
Postgres per-traveller advisory lock in WorkflowLockService. Busy/unavailable
locking fails safely; it does not run the mutation. Background searches capture
the initiating session generation and reject late writes after reset/replacement.
Results are persisted before their outbound announcement. Existing inbound
message claims continue to protect provider delivery retries.

MessageRepository writes role-aware, idempotent inbound and generated assistant
turns. Generated replies are labelled as delivery-unverified in model history;
they are not proof of provider delivery, availability, booking or payment.
Conversation persistence failures are reported to the traveller. MemoryUpdater
commits criteria proposals through the vertical service without overwriting its
rich record; profile corrections require the approved profile form.

Provider integration must preserve identifiers needed for details, rate recheck,
booking, cancellation, and audit without exposing those identifiers to users.
