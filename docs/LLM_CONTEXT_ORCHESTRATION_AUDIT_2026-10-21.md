# YANA LLM, context, orchestration and dynamic UI audit

Date: 2026-10-21. Phase 1 only; implementation is pending backend-developer review.

## Scope and baseline

- Branch: `codex/yana-sports-icc-hackathon-20261001`.
- Audited commit: `b7c657e86845dc80a3cd491cd2e987e5fa583b9a`.
- Initial working tree: untracked `.archify/` and `output/`; preserved.
- Read `AGENTS.md`, `docs/PROJECT_HANDOFF.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, and `docs/CONVERSATION_ORCHESTRATOR_BASELINE_2026-10-16.md`, then reconciled their claims against current code and tests. The August handoff is historical, not the active branch description.
- This change adds this audit document only. No runtime, prompt, configuration, schema, state or execution changes. No deployments, bookings, payment activation or live-provider smoke commands.
- Findings below are source findings unless explicitly supported by the executed tests. Passing mocked tests does not prove production infrastructure or live-model behavior.

## Assessment

The selected orchestration pipeline is integrated for general interpretation, but the proposed core system prompt and reliable context package are not integrated end to end. Existing deterministic forms, vertical session repositories, provider adapters and outbound rendering should be retained. This is an integration and validation task, not a replacement architecture.

The most consequential gaps are an ignored interpreter prompt, profile data dropped before the model request, absent conversation-history retrieval, unconsumed memory updates, inconsistent workflow field contracts, and an itinerary workspace that records edit requests without applying them.

## Actual entry points and call chains

`src/app.ts` mounts the provider webhook, form and itinerary routes.

```text
Twilio POST /webhook/whatsapp (src/routes/twilioWhatsAppWebhook.ts:23)
OpenWA POST /webhook/openwa (src/routes/openWaWebhook.ts:18)
Meta POST /webhook/meta (src/routes/metaWhatsAppWebhook.ts)
  -> normalization, correlation, provider-specific auth/deduplication
  -> processNormalizedInboundMessage (src/routes/webhook.ts)
  -> optional SpeechToTextService.transcribe for voice input
  -> processInboundMessage (src/routes/webhook.ts:234)
     -> out-of-scope/unsupported-service checks, profile gate, reset/resume
     -> ConversationControlPlane.plan (:309)
        -> ActiveConversationStateLoader.load
        -> Orchestrator.plan -> ContextBuilder -> ConversationAnalyzer
        -> DecisionEngine -> MemoryUpdater.prepareUpdate
     -> existing deterministic gates/vertical continuations
        -> WorkflowExecutorRegistry for active restaurant/excursion
        -> existing hotel/logistics/itinerary handlers otherwise
     -> conditional LLM paths A-D below
     -> existing session saves, provider result enrichment and outbound delivery
```

Early returns precede the control plane. The claim that every normalized message passes through it is therefore too broad. Deterministic gates do not need LLM calls.

```text
A. General unclear request / side question
   webhook.ts:520 -> ConversationControlPlane.interpret
   -> state is loaded again -> Orchestrator.plan
   -> PromptService.buildInterpreterPrompt
   -> LLMDecisionInterpreter.interpret -> LLMService.decide
   -> validateAndMapDecision -> DecisionEngine
   -> mapOrchestrationPlanToLegacyDecision (webhook.ts:3158)
   -> existing branch-based workflow execution / optional wording (D)

B. Ambiguous message against an active hotel session
   webhook.ts:1838 routeActiveConversation
   -> routeActiveConversationWithLlm (:1859)
   -> LLMService.decide (:1869)
   -> local confidence/intent/action check -> continue or start fresh hotel search

C. Optional hotel criteria extraction
   webhook.ts:504 -> HotelIntakeService.handleMessage -> extractCriteria
   -> extractCriteriaWithLLM (HotelIntakeService.ts:427)
   -> LLMService.generateUIContent (:436)
   -> JSON extraction/sanitization -> deterministic criteria win conflicts

D. Clarification / general-inquiry wording
   webhook.ts:583, :688, :713 -> ConversationManager.createMessage
   -> defaultConversationLLM.generateText (ConversationManager.ts:288)
   -> LLMService.generateUIContent
   -> sanitize text / blocked-internal-term check / deterministic fallback
```

All four language-generation paths ultimately use `LLMService.callOpenAICompatible` (`src/services/LLMService.ts:290`) for configured `openai`, `openrouter`, or `groq`, or the explicit mock branch. There are no other production language-generation call sites found by the source search. Examples and demo imports are not live LLM integrations.

`SpeechToTextService` uses `/audio/transcriptions` before orchestration; this is audio transcription, not a workflow decision and should not receive a travel decision prompt. Translation/TTS code is a separate service boundary, not another discovered chat-model decision call.

Website paths:

- `src/routes/forms.ts:619`: token and CSRF checks -> Zod validation -> ProfileService -> profile/service-request repositories -> vertical session saves. Itinerary submission calls the deterministic `ItineraryPlannerService.plan`, saves a session and creates/updates the workspace. No LLM call here.
- `src/routes/itineraryWorkspace.ts:11,23`: GET renders server-generated HTML; POST `/itinerary/:shareToken/state` writes selected day and pending change labels through `ItineraryWorkspaceService`. No LLM, ContextBuilder, or orchestrator here. This is appropriate for display state, but it is not implemented itinerary editing.
- `src/routes/demo.ts` explicitly does not initialize LLMService. Sports/demo/admin routes do not introduce another language-generation call in the inspected source.

## Per-call audit matrix

| Requirement | A: orchestrated interpretation | B: hotel rerouting | C: hotel extraction | D: response wording |
|---|---|---|---|---|
| Actual system role instructions | `Return only valid JSON matching the requested schema.` | Same as A | `Return concise WhatsApp-ready text only.` | Same as C |
| Other instructions delivered | Generic booking-platform classifier and discovery/itinerary routing guidance in the user message | Same generic classifier | User-message task asks for criteria JSON, conflicting with outer text-only framing | Generic WhatsApp writer plus ConversationManager concierge rules in the user message |
| Dynamic context delivered | Current text; active flow as currentIntent, schema, fields, missing fields; static schema-name list | Current text and hotel criteria/schema only | Current text, deterministic extraction for this message, base date | Input, inbound profile hints, normalized decision/parameters/missing fields; services and constraints |
| Active workflow/session | Partial snapshot; no session ID/revision or itinerary contents/results | Hotel criteria; no stage, missing fields, revision or selected result | No authoritative active snapshot; saved intake criteria are not passed to the extraction call | Interface accepts session/currentFlow but the three production callers omit them |
| History/summary | Not retrieved or passed | None | None | Interface accepts memory, but production callers omit it; no history retrieval |
| Output contract supplied | intent string, parameters object, missingFields array, four suggestedAction values, confidence and optional reasoning; schema names only | Same generic contract; allowed schema name is hotel only | Six named hotel keys, dates/board-basis/budget instructions; no strict response schema | Plain text with presentation rules; no semantic UI decision contract |
| Backend validation | JSON checks -> intent mapping/field filter -> DecisionEngine; substantial gaps below | JSON checks plus confidence >= 0.7, hotel intent and two allowed actions | JSON parse plus field sanitization; deterministic extraction overrides LLM for the same message | Nonempty text and internal-term filtering; no factual/semantic verification |
| Persistence | Model call itself saves nothing; proposed memoryUpdate has no runtime consumer. Vertical handlers separately save actual state | Selected route invokes existing fresh-search saves; no orchestration memory persistence | Existing intake state and TravelerProfile saved to StateStore; downstream flow has separate session persistence | No memory or conversation save in this path |
| Bypass | Uses builder/orchestrator but ignores its generated prompt | Bypasses builder and orchestrator | Specialized service legitimately owns extraction, but bypasses shared context/prompt | Presentation service legitimately owns wording, but bypasses shared context/prompt |

Exact filenames: `src/orchestration/PromptService.ts` exists; `src/services/PromptService.ts` does not. Both `src/orchestration/Orchestrator.ts` and legacy `src/services/Orchestrator.ts` exist. `CoreSystemV2.ts` is another tested deterministic planner with no production caller found beyond exports. Do not create another planner.

## Findings and risks

### 1. Prompt and profile integration are incomplete — high priority

`Orchestrator.ts:168` builds the specialized interpreter prompt, but `LLMDecisionInterpreter.ts:23` deliberately names its argument `_prompt` and never forwards it. The requested role/intent/entities contract in PromptService is consequently not the contract received by the model. `PromptService.buildResponseGuidance` has no production caller.

The adapter constructs `userProfile` with preferred language and nationality, but `LLMService.buildDecisionPrompt` never reads `userProfile`. Thus even these two supplied values do not reach the provider. Saved name, currency, travel style, dietary and accessibility preferences are not assembled for interpretation. ConversationManager uses literal language `en` and receives inbound display-name/country hints instead of the loaded authoritative profile.

The proposed full YANA core prompt is absent. Current safety instructions are fragmented across prompt builders. Most instructions and all dynamic text are concatenated into a single user-role string; the system message contains only formatting guidance. No consistent trust boundary, context budget, result freshness contract or personal-data allowlist exists in this path. Merely concatenating the proposed prompt would leave the integration defect intact.

### 2. Defined context is not retrieved context — high priority

`ContextBuilder.ts:18` copies supplied input; it does not retrieve repositories. Profile retrieval occurs in the webhook and active sessions in the state loader, which is a usable existing seam. However:

- `conversationHistory` exists on LLMService.ContextPackage but no production caller populates it. `MessageRepository.findBySessionId` exists; the active webhook pipeline does not call it or persist turns through `SessionManager`. There is no integrated summary mechanism.
- `recentServiceRequests` exists in the builder and control-plane inputs, but the webhook does not supply it, and the interpreter does not serialize it. Separate restore handlers retrieve latest forms for specific continuations.
- The active snapshot omits full itinerary, selected day, verified provider results, source/freshness, authorization details and schema versions. Existing session result data should be projected selectively rather than serializing whole sessions containing internal tokens.
- Latest `updatedAt` determines ownership across five verticals. There is no explicit ownership revision, stale-context check or conflict resolution. `plan` and later `interpret` reload state independently.
- ContextBuilder shallow-copies field containers; nested data remains shared. There is no enforced item/string/token budget, despite historical descriptions of bounded/immutable context.
- Repositories can fail into `null` and session services log fallback; downstream code cannot consistently distinguish unavailable context from a genuinely absent workflow. Profile/state load failures occur outside the generic LLM clarification catch in the webhook.

### 3. Backend control exists, but validation is incomplete — high priority

Positive: profile gate, deterministic commands, recalculated missing fields, field allowlists, selected flow dispatch and provider boundaries exist. LLM output is not direct booking/payment execution.

Gaps:

- `parseDecisionOutput` checks only that parameters are an object (arrays pass) and missingFields is an array (non-string elements pass). The downstream mapper assumes strings. No strict provider JSON schema/unknown-field rejection is requested.
- Intent recognition uses substring regular expressions, not an exact enum. A string containing an accepted service word can be mapped into a valid flow. The schema-name list in the prompt is guidance, not enforced intent/schema validation.
- Field allowlisting normalizes names for comparison but preserves original keys. For example `checkin_date` passes the filter yet does not satisfy backend `checkinDate`.
- DecisionEngine merges interpretation entities even when the interpretation loses the confidence comparison. Field presence checks do not validate types, dates, ranges or explicit-correction provenance. The configured LLM confidence threshold is not applied by this engine.
- LLM role, clarification question and handoff semantics are not preserved end to end: the adapter derives role from suggestedAction; the engine has no corresponding handoff decision branch; the legacy bridge reduces actions again.
- `src/services/Orchestrator.ts` has schema/business-rule validation tests, but no production `validateLLMDecision` caller was found. Those tests do not establish validation of the current control plane.

### 4. Required fields and schema names diverge — high priority

`ActiveConversationStateLoader.ts`, `DecisionEngine.ts:209`, hotel intake, form Zod schemas and request mappers each define overlapping requirements. Examples:

- Hotel loader requires location/dates/guests; new-flow DecisionEngine also requires rooms; conversational intake additionally requires budget.
- Restaurant discovery loader requires location; new-flow DecisionEngine also requires guests. Booking forms legitimately need further fields, but that distinction is not a versioned workflow contract.
- Logistics loader uses `destination`, `pickupDate`, schema `search_transport`; DecisionEngine uses `dropOffLocation`, `date`, schema `logistics_request`; the interpreter permits `dropofflocation`/`pickupdate`, not all engine names.
- Loader computes awaited fields only for stage `awaiting_preferences`; missing fields become empty in other stages without a shared workflow-definition decision.

Consequences include repeated questions, apparently complete invalid criteria, and inconsistent new-flow versus resumed-flow behavior. Versioned DB schemas and SchemaEngine already exist, but are not wired into active context/DecisionEngine as the single runtime definition.

### 5. Memory preparation is not persistence — high priority

`MemoryUpdater.prepareUpdate` only returns a copied session/profile patch. The only production references to `memoryUpdate` are its construction/return in the orchestrator; the webhook/executor registry does not consume it. Proposed preference changes are therefore not durable merely because shouldPersist is true.

Vertical sessions do have actual StateStore writes and Postgres repositories. Typical saves write active state first, catch durable-save errors and log `memory_only` (for example `itinerarySessionService.ts:149` and `hotelSearchSessionService.ts:348`). Callers receive no durability outcome. A subsequent request can appear successful locally while a restart loses data. Some durable upserts also return without saving if the backing user does not exist. Profile/service-request repositories are separate and should remain authoritative.

Postgres session upserts use transactions and row locks around preferences JSON. That protects the repository write but does not serialize the full read/interpret/execute/write lifecycle or reject a stale session revision. Existing inbound deduplication is not concurrency protection for two distinct messages.

### 6. Dynamic UI and itinerary editing are partial — high priority for channel parity

Existing reusable foundations: `validation/formSchemas.ts` (Zod), `routes/forms.ts` (fixed form definitions), `utils/htmlFormRenderer.ts`, `SchemaEngine` field prompts, `WhatsAppRenderer.RenderableContent`, and Meta/OpenWA/Twilio delivery components. Backend token/CSRF/schema validation and saving are integrated. No new UI library is needed for the initial integration; the current website uses Express-rendered HTML, not a separate frontend framework.

There is no shared versioned semantic decision containing approved mode/schema, validated values, permitted actions and workflow correlation/revision. Existing renderer unions and field UI modes are useful lower-level contracts, not this cross-channel contract. Invalid semantic mode/schema tests cannot pass meaningfully until that contract exists.

`ItineraryWorkspaceService` has StateStore-only workspaces, a 30-day TTL, a currentVersion and ten snapshots, but no Postgres workspace repository. `/state` records arbitrary pendingChange text and a positive finite selectedDay without checking integer/day bounds, allowed edit actions or expected version. It does not apply an edit or update the authoritative itinerary session. Its UI announces “Saved” without checking response success.

WhatsApp edit handling (`webhook.ts:936`) appends text to criteria.additionalPreferences, regenerates, saves the session and updates the workspace. However, `ItineraryPlannerService` never reads additionalPreferences. Thus the persistence/regeneration path exists, but a request such as “more beach time” is not proven to change the itinerary and can regenerate the same plan. Existing edit tests assert calls/wording, not the resulting changed itinerary and subsequent reload. Website pending changes have no consumer that resolves this gap.

### 7. Existing operational safeguards should be preserved

Inbound idempotency already has Redis/shared Postgres claims and fails closed for repeated external effects. Tests cover concurrent claims/restart using doubles; this is not missing wholesale. Background search, batches of three, profile-first forms, voice handling and provider-specific cards are covered by current regression tests. Form tokens/CSRF are process-local Maps, so multi-instance/restart behavior needs deliberate treatment when unifying channel submissions. Avoid replacing working safeguards with an LLM-selected action.

## Verification evidence

Executed on the audited baseline:

| Check | Result | Limits |
|---|---|---|
| `npm.cmd run build` | PASS | TypeScript compilation only |
| `npm.cmd test` | PASS: 111 files, 1,087 tests; 67.41 seconds | Vitest excludes `*.integration.test.ts`; mocks/fallbacks do not prove live infrastructure |
| Focused Vitest run below | PASS: 17 files, 230 tests; 9.04 seconds | Same mocked/local limitations |
| `npm.cmd run db:validate` | PASS: 34 required tables, 37 required indexes | Validates migration files, not deployed DB schema or connectivity |

Focused command:

```powershell
npm.cmd exec -- vitest --run src/orchestration src/services/LLMService.test.ts src/services/ConversationManager.test.ts src/services/HotelIntakeService.test.ts src/services/ItineraryPlannerService.test.ts src/routes/forms.test.ts src/routes/webhook.hotel-flow.test.ts src/routes/twilioWhatsAppWebhook.architecture.test.ts src/services/InboundIdempotencyService.test.ts
```

Test logs are local temporary files `%TEMP%/yana-audit-tests-20261021.log` and `%TEMP%/yana-audit-focused-20261021.log`; do not commit raw test logs. Infrastructure fallback warnings occurred. No baseline failures remain from these commands. Database/Redis integration suites and live provider acceptance were not run.

Evidence classification:

- **Implemented and integrated, tested with mocks/local doubles:** selected control plane; deterministic missing-field calculation; schema field filtering; provider gateways; forms; vertical session saves; hotel recovery contract; inbound idempotency; itinerary generation/workspace display/pending-label saves.
- **Implemented and unit tested, incompletely integrated:** PromptService interpreter instructions; response guidance; MemoryUpdater patches; legacy services/Orchestrator schema validation; conversation MessageRepository; versioned schema repository.
- **Mocked, not established end to end:** most LLMService tests use its fixed mock response; one test captures a stubbed compatible-provider request for discovery routing. Interpreter tests call validateAndMapDecision directly. Orchestrator tests inject a fake interpreter. None proves the requested prompt/profile/history travels from a real production entry point to the HTTP body.
- **Missing:** integrated bounded history/summary loading, explicit context-load status/freshness, canonical workflow/UI contracts, persisted orchestration memory outcome, applied website itinerary edits, revision checks covering a full workflow mutation.

## Recommended minimal implementation sequence — approval required before code changes

1. **Consolidate prompts at the existing seam.** Make `orchestration/PromptService.ts` own the supplied YANA core instructions plus purpose-specific decision/extraction/wording contracts. Extend LLMService to send trusted instructions as system content and separately serialized untrusted request data. Wire the actual adapter to this contract; preserve discovery routing guidance and compatible-provider formatting. Use a dedicated structured extraction purpose rather than asking a text-only writer for JSON. Keep one existing selected orchestrator.
2. **Formalize and retrieve relevant context.** Extend ContextBuilder's existing types/projections, with loading in the control-plane/state-loader boundary: request/channel/revision, allowlisted profile, bounded persisted turns or summary, active workflow, canonical collected/missing fields, versioned schema/UI allowlists, relevant itinerary/result projections, freshness and authorization. Reuse MessageRepository/ProfileService/vertical repositories. Add actual turn writes and explicit unavailable-versus-absent outcomes. Budget/redact context before provider serialization.
3. **Canonicalize validation and execution incrementally.** Adapt existing Zod schemas/mappers and SchemaEngine into one versioned workflow-definition contract, retaining discovery-versus-booking differences. Strictly validate exact intents, canonical field names/types, corrections, confidence and transitions before entity merging. Move hotel rerouting behind the current control plane. Extend WorkflowExecutorRegistry to hotel/logistics/itinerary using existing handlers; avoid a wholesale webhook rewrite. Keep specialized extraction and wording as bounded services, not new planners.
4. **Make persistence outcomes explicit.** Have existing executors apply validated session/profile updates through the relevant repositories once; do not blindly persist planner snapshots over richer vertical state. Surface durable/degraded/failed outcomes, preserve supported memory fallback, and prevent false success. Add expected workflow revision and atomic commit/serialization sufficient for multiple app instances; retain current inbound claims.
5. **Add the shared semantic UI contract.** Build a versioned discriminated union using current names where equivalent. Allow chat/clarification, approved form, results, itinerary editor and confirmation; validate schema ID, initial values, missing fields, permitted actions and workflow revision. Backend chooses authoritative mode and transitions; LLM can only propose allowed decisions. Reuse existing HTML forms and channel adapters. No new UI library proposed.
6. **Implement real shared itinerary edits.** Both channels submit allowlisted structured edit commands with trip/day/revision; validate and apply deterministically where possible, persist through the existing itinerary session repository, then project into workspace versions. Resolve supported free-text edits into those commands. Return unsupported/clarification instead of saving an ineffective request as completed. Rebuild workspace display from authoritative itinerary state after cache loss.
7. **Update architecture/handoff with verified integration and limits.** Document canonical contracts, prompt ownership, persistence semantics, fallback behavior and any configuration names/defaults introduced. Update historical overstatements only when corresponding implementation and tests justify it.

Steps 1-4 address backend correctness first; steps 5-6 complete cross-channel UI behavior. Each should be reviewable independently. The audit itself grants no implementation approval.

## Test plan and acceptance gates

| Requested proof | Existing evidence | Required addition after approval |
|---|---|---|
| 1. Production prompt/context delivery | Stubbed LLMService routing-guidance request; isolated prompt tests | Drive normalized webhooks through real control plane/adapter to stubbed fetch; assert system role/core prompt and relevant profile/history/workflow for every A-D path; test provider variants |
| 2. Saved follow-up continuity | Intake/session and restaurant awaited-field tests | Persist profile and turns, issue next request through production path, assert known details are not re-asked and selected language is used |
| 3. Interrupted resume | Hotel shared-repository recovery doubles and webhook restore tests | Multi-vertical switch/return, restart/cache loss, expired/unavailable/contradictory state with explicit outcomes |
| 4. Backend missing fields | DecisionEngine recalculation tests | Canonical definitions across fresh/resumed/discovery/booking flows; malformed values remain invalid/missing |
| 5. Stale/conflicting context | Latest-session selection and explicit restaurant correction tests | Reject stale revisions; deliberate correction/provenance handling; failed loads never imply known-empty memory |
| 6. UI allowlist enforcement | Existing renderer/field UI tests | Reject unknown modes/schema IDs, incompatible versions/flow/actions, invalid prefill and replayed submissions |
| 7. Channel parity | Provider rendering and forms tested separately | Same semantic workflow decision projects to website and all WhatsApp providers; submissions converge on same persisted revision |
| 8. Form validation/save | forms.test.ts validates profile/service submissions, CSRF and token consumption | Revision binding, reload evidence, durable failures, concurrent/retry/multi-instance submission behavior |
| 9. Itinerary edits persist visibly | Mocked edit regeneration calls and workspace pending-label test | Assert actual changed day/activity/criteria, persisted reload and visibility from other channel; restart; unsupported edit; expected-version conflict |
| 10. Memory failure handling | Existing infrastructure fallbacks and hotel failed-lookup test | Inject profile/history/session write failures; assert surfaced status and truthful responses; no false durable success |
| 11. Duplicate/concurrent safety | Inbound claim concurrency/restart doubles | Distinct simultaneous messages, async search finishing after reset/switch, concurrent website/WhatsApp edits; no lost updates/stale overwrite |
| 12. Workflow regression | Current 1,087-test baseline | Retain full suite/build plus focused flows per increment; cover enabled/disabled/failure/fallback flags; db:validate for migrations |

All provider responses should be fixtures/mocks. Use isolated database/Redis integration fixtures only when available and authorized; never substitute live credentials, real transactions or deployment for these gates.

## Remaining production blockers for this objective

1. Correct trusted core prompt and relevant traveller context reaching every applicable provider call.
2. Canonical validated workflow fields/actions/schema versions, with explicit context failure and stale-data behavior.
3. Persisted conversational continuity and authoritative memory outcomes across restart and app instances.
4. Shared validated UI decisions and applied itinerary edits visible from both channels.
5. Concurrency protection beyond duplicate-message claims, including background-result and cross-channel edits.
6. Integration evidence for real persistence infrastructure; live LLM/provider behavior is outside this audit's proof.

Existing supplier onboarding, confirmed inventory, payment/booking acceptance and deployment readiness remain separate concerns; this audit does not certify them. Stop here for backend-developer review of the proposed sequence and acceptance gates.
