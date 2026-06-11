# YANA / OGO Final Requirements Specification

**Document Type:** Product Requirements Specification (PRS) / System Requirements Specification (SRS)  
**Version:** 1.0  
**Status:** Final Draft for Engineering Handoff  
**Audience:** Product, Engineering, UX, QA, DevOps, Integrations, Vendor Operations, Leadership  
**Prepared For:** Development team with no prior context from earlier conversations  
**Last Updated:** 2026-04-17

---

## 1. Executive Summary

YANA / OGO is a **WhatsApp-first AI orchestration platform** for tourism and later other real-world service domains. It is **not a chatbot** in the traditional sense. It is a **state-aware orchestration engine** that uses:

- WhatsApp as the primary user interface
- Backend-controlled state and context
- Schema-driven workflows
- One primary LLM for decision support and UI assistance
- MCP-style tool calling as an interface layer
- Nango as the integration/auth/normalization layer where appropriate
- Deterministic backend execution for bookings, payments, vendor coordination, and service fulfillment

The platform must guide users through a **structured decision flow**, narrow intent with WhatsApp UI, fill missing schema fields using buttons/lists/interactive elements, execute tool calls only when the request is sufficiently structured, and return reliable results with strong observability and operational control.

The first production-grade vertical is **tourism orchestration**, beginning with **hotel search and booking**, with architecture designed for later expansion to transport, excursions, restaurants, and other service categories.

---

## 2. Product Vision

### 2.1 Vision Statement
Build a **WhatsApp-native orchestration layer** that allows users to discover, compare, book, pay for, and coordinate real-world services through guided AI-assisted flows.

### 2.2 Product Positioning
YANA / OGO is:

- a state-aware orchestration system
- a schema-driven transaction platform
- a real-world service execution layer
- an AI-assisted decision engine with backend-owned execution

It is **not**:

- a generic chatbot
- a simple travel marketplace
- a pure LLM wrapper
- a UI-less API-only product

### 2.3 Core Principle
**LLM decides; backend executes.**

The LLM may infer intent, extract parameters, suggest the next step, and format UI-supporting content, but all critical execution must remain under backend control.

---

## 3. Product Goals

### 3.1 Primary Goals
1. Provide fast, low-friction service orchestration over WhatsApp.
2. Reduce ambiguity by using WhatsApp UI as a schema-constraining interface.
3. Support natural language and structured UI as dual entry modes.
4. Enable bookings, payments, and vendor coordination through a reliable backend.
5. Maintain low latency and high operational reliability.
6. Support multiple languages across users, vendors, and APIs.
7. Create an extensible platform that can scale to additional verticals and integrations.

### 3.2 Success Criteria
The system should:

- acknowledge user requests quickly
- understand and narrow intent with minimal friction
- ask for missing information using WhatsApp UI
- execute bookings/payments reliably
- maintain durable session and transaction state
- support fallback, human intervention, and manual recovery
- log every decision and tool interaction for traceability

---

## 4. Scope

### 4.1 In Scope (Phase 1)
- WhatsApp-first user interaction
- hotel search and booking flow
- multilingual user handling
- schema-based missing-field collection
- MCP-style tool calling
- Nango-backed provider integration where needed
- durable state and audit logging
- payment initiation and confirmation
- vendor/operator visibility and control
- TTS output options for supported flows

### 4.2 In Scope (Architecture Foundation)
- extensible schema registry
- extensible tool registry
- translation layer for users, vendors, and APIs
- support for voice input/output extensions
- support for rides/excursions as later modules without redesigning the core

### 4.3 Out of Scope for Initial Production Launch
- multiple verticals launched simultaneously
- multi-LLM critical-path orchestration
- public API for third-party external developers
- full agentic autonomy without safeguards
- deep itinerary planning as a required first-path feature
- autonomous vendor management without operator control

---

## 5. Guiding Product Principles

1. **WhatsApp is the primary UX layer.**
2. **Backend state is the source of truth.**
3. **UI narrows intent and fills schema.**
4. **Natural language is supported, but constrained flows should dominate critical transactions.**
5. **MCP is an interface/wrapper layer, not the product brain.**
6. **Nango is an integration execution/auth/normalization layer, not the business logic layer.**
7. **Execution reliability matters more than model sophistication.**
8. **Every important action must be observable and recoverable.**
9. **Multiple languages are first-class requirements, not add-ons.**
10. **Fallback and human recovery paths are mandatory.**

---

## 6. Users and Actors

### 6.1 End Users
- tourists
- local travelers
- repeat users with saved context/preferences
- first-time users entering through WhatsApp text or UI buttons
- users who prefer voice interaction or audio playback

### 6.2 Internal Actors
- operators / concierge staff
- customer support staff
- vendor operations staff
- admins
- finance/settlement staff

### 6.3 External Actors
- hotels
- ride providers
- vendors/excursion operators
- payment providers
- telco/billing providers
- API providers

---

## 7. High-Level System Architecture

### 7.1 Logical Flow
User → WhatsApp → Twilio/WhatsApp Business API → AI Gateway → State/Context Layer → Orchestrator / Schema Engine → LLM (decision/UI support) → MCP tool interface → Nango / integration adapters → External APIs / vendors / payment providers → Response renderer → WhatsApp delivery

### 7.2 Architectural Responsibilities

#### A. WhatsApp / Twilio Layer
- inbound webhook delivery
- outbound message delivery
- interactive replies (buttons, lists, templates, carousels where supported)
- media delivery
- message status callbacks

#### B. AI Gateway / Firewall
- signature validation
- abuse detection
- rate limiting
- session lookup initiation
- message normalization
- request ID generation
- immediate acknowledgement / perceived responsiveness

#### C. State and Context Layer
- hot session state in Redis or equivalent
- durable state in Postgres or equivalent
- context package assembly
- user profile retrieval
- behavioral summary retrieval
- active flow / schema state retrieval

#### D. Orchestrator / Schema Engine
- determine current intent/mode
- decide next system action
- identify required and missing fields
- choose whether to ask UI questions or execute a tool
- maintain state transitions
- enforce business rules and permissions

#### E. LLM Layer
- intent detection
- entity and parameter extraction
- missing field identification
- tool suggestion
- response wording support
- optional UI copy generation
- optional TTS text drafting

#### F. MCP Tool Interface
- validate tool contracts
- normalize tool input/output at interface boundary
- route tool calls to correct internal adapter
- log tool calls
- remain replaceable and thin

#### G. Nango / Integration Layer
- provider credential management
- OAuth and token refresh
- provider-specific mapping
- retries
- rate limit handling
- response normalization
- provider-level observability hooks

#### H. External Services
- hotel search/booking providers
- transport APIs
- weather APIs
- maps/traffic APIs
- payment gateways
- telco billing
- vendor systems / POS where available

#### I. Response Renderer
- deterministic WhatsApp-safe formatting
- UI validation (buttons, list limits, text lengths)
- multilingual message generation
- optional TTS asset generation and linking

#### J. Operations Layer
- audit logs
- decision logs
- replay / retry tools
- manual override
- support dashboard
- vendor/admin tools

---

## 8. Interaction Model

### 8.1 Dual Entry Mode
The system must support two entry modes:

#### Mode A — Structured UI (Primary)
Used for:
- booking
- comparison
- payment steps
- sensitive flows
- missing schema resolution

#### Mode B — Natural Language (Fallback / Overlay)
Used for:
- flexible input
- expressive requests
- discovery
- conversational recovery

Natural language must be mapped into the same schema/state system as structured flows.

### 8.2 WhatsApp UI as Schema
WhatsApp UI is not just presentation. It is a schema-constraining mechanism.

Buttons, lists, and prompts must be used to:
- narrow ambiguous intent
- collect missing fields
- confirm execution
- select from ranked options
- switch between modes (explore/book/compare)

### 8.3 Core UX Pattern
1. User sends text or taps button.
2. System loads state/context.
3. System narrows intent if required.
4. System asks for missing schema via WhatsApp UI if necessary.
5. System executes tool only when schema is complete enough.
6. System returns options/results.
7. User confirms/selects.
8. System executes booking/payment steps.
9. System confirms outcome and updates state.

---

## 9. Functional Requirements

## 9.1 User Messaging and Session Requirements
1. The system shall receive inbound WhatsApp text, media, audio, and interactive responses.
2. The system shall create a session for new users.
3. The system shall resume prior context for returning users.
4. The system shall maintain current flow state across turns.
5. The system shall support immediate acknowledgement to the user before expensive processing completes.
6. The system shall append conversation history in durable storage.
7. The system shall preserve original user language content and translated/normalized variants.

## 9.2 Intent Narrowing Requirements
1. The system shall support top-level intent narrowing with WhatsApp UI.
2. The system shall provide configurable top-level modes such as Explore, Book Now, Compare.
3. The system shall use UI narrowing when confidence is low, ambiguity is high, or multiple categories are possible.
4. The system shall bypass unnecessary UI steps if user input already supplies sufficient fields.

## 9.3 Schema Management Requirements
1. Every tool-supported workflow shall be backed by a schema definition.
2. Each schema shall define:
   - required fields
   - optional fields
   - validation rules
   - UI metadata for missing fields
   - API/provider mappings
   - localization labels
   - fallback prompts
3. Missing fields shall be collected with WhatsApp UI where possible.
4. If a missing field is not suited for buttons/lists, the system may request typed input.
5. The schema engine shall enforce field order, optional shortcuts, and conditional fields.
6. The schema system shall support versioning.

## 9.4 LLM Decision Requirements
1. The LLM shall run in at least one decision mode.
2. Decision mode output shall include:
   - intent
   - parameters extracted
   - missing fields
   - suggested next action
   - confidence metadata
3. The LLM shall not directly execute side effects.
4. The backend shall validate all LLM outputs before proceeding.
5. The LLM shall optionally operate in a UI-support mode for wording/formatting, while deterministic rendering remains preferred for common transactional flows.

## 9.5 MCP Tool Calling Requirements
1. Tool calling shall use a contract-driven wrapper layer.
2. MCP shall be treated as an interface layer, not the core product logic layer.
3. Every tool must have:
   - schema
   - auth/integration mapping
   - validation rules
   - input normalization
   - output normalization
4. Tool calls shall be logged with correlation IDs.
5. Failed tool calls shall return structured error states.
6. Tool call retries shall be policy-driven.

## 9.6 Nango Requirements
1. Nango shall be used where appropriate for:
   - credential storage
   - OAuth handling
   - token refresh
   - provider normalization
   - retries/rate limit behaviors
2. Business logic shall not depend on Nango-specific behavior.
3. The system shall remain capable of direct integration without Nango where necessary.
4. Provider adapters shall be replaceable.

## 9.7 Hotel Search Requirements (First Vertical)
1. The system shall support hotel search by location and date.
2. The system shall support missing-field resolution via WhatsApp UI.
3. The system shall normalize hotel results into internal schema.
4. Search results shall include, where available:
   - hotel ID
   - hotel name
   - price
   - currency
   - rating
   - review count
   - location
   - distance
   - amenities
   - images
   - cancellation policy
   - compliance/certification markers
   - booking reference or internal booking token
5. The system shall return hotel results in a WhatsApp-safe structured format.
6. The system shall support “Book Now” and “More Info” actions on hotel results.

## 9.8 Booking Requirements
1. The system shall support booking initiation after result selection.
2. Booking state shall be durable and recoverable.
3. Booking confirmation shall occur only after provider confirmation and payment requirements are satisfied.
4. The system shall support booking holds / provisional reservations if the provider supports them.
5. The system shall support cancellation and timeout rules.
6. Booking records shall be auditable end to end.

## 9.9 Payment Requirements
1. The system shall support payment initiation through configured providers.
2. The system shall support telco billing where available.
3. The system shall support payment links where telco billing is not available.
4. Payment webhook callbacks shall update booking state reliably.
5. Payment state shall include:
   - initiated
   - pending
   - succeeded
   - failed
   - timed out
   - refunded/cancelled
6. The system shall protect against duplicate charges and duplicate callbacks.

## 9.10 Translation and Multilingual Requirements
1. The system shall support multiple user languages.
2. The system shall detect or store preferred language per user.
3. The system shall maintain a canonical internal representation for schemas and tool inputs.
4. The system shall translate user utterances into canonical internal form when necessary.
5. The system shall translate WhatsApp UI labels, messages, and confirmations into the user’s preferred language.
6. The system shall translate vendor-facing requests into the vendor’s preferred language when vendor messaging is used.
7. The system shall translate API inputs only when required by the provider contract.
8. The system shall preserve:
   - original text
   - translated text
   - normalized/canonical form
9. The system shall support multilingual fallback when confidence is low.
10. The system shall allow operator override for mistranslations.

## 9.11 Text-to-Speech and Voice Requirements
1. The system shall support optional text-to-speech output for selected response types.
2. TTS shall support at least the major supported user languages.
3. TTS outputs may be delivered as:
   - audio file
   - WhatsApp voice note/media link
   - generated audio attachment
4. The system shall allow TTS to be enabled by user preference or message type.
5. The system should support speech-to-text for inbound voice notes in later phases, but STT is not required for initial launch unless prioritized.
6. TTS generation shall not block critical transaction completion.
7. TTS content shall be generated from the final validated response, not directly from raw model output.

## 9.12 Vendor Coordination Requirements
1. The system shall support vendor communication where direct APIs are unavailable.
2. Vendor requests shall use structured templates where possible.
3. The system shall support vendor-preferred language.
4. Vendor interactions shall be logged.
5. Vendor scoring and fallback routing shall be supported in later phases but the data model should be ready from the start.

## 9.13 Human Handoff Requirements
1. The system shall support escalation to human operator.
2. Handoff criteria shall include:
   - low confidence
   - repeated failure
   - payment issues
   - vendor exception
   - unsupported request
3. The operator shall receive:
   - session summary
   - user language
   - current schema state
   - tool results so far
   - pending next actions
4. The user shall be informed when a human is taking over.

## 9.14 Proactive and Follow-up Requirements
1. The system may schedule reminders, check-in alerts, or weather/traffic updates after confirmed bookings.
2. Proactive jobs must be optional and configurable.
3. Proactive messaging must not trigger if consent or policy disallows it.
4. Scheduled jobs shall be linked to the originating booking/session.

---

## 10. Non-Functional Requirements

### 10.1 Performance
1. The system should provide immediate acknowledgement or perceived progress quickly.
2. The system should minimize synchronous steps on the user-critical path.
3. Redis/session retrieval should be optimized for low latency.
4. Provider caching should be used where appropriate.
5. UI rendering should not require a second LLM call for all common flows.

### 10.2 Reliability
1. The system shall be resilient to duplicate webhooks.
2. The system shall be resilient to provider failure.
3. The system shall implement retry policies.
4. The system shall maintain idempotency for booking/payment actions.
5. The system shall support degraded-mode operation.

### 10.3 Scalability
1. The architecture shall support additional tools/providers without redesigning the core.
2. Session storage, rendering, orchestration, and integrations shall be separable over time.
3. New verticals shall be addable via schemas and tool registry extensions.

### 10.4 Security
1. Signature validation is required for webhooks.
2. Secrets must be stored securely.
3. Sensitive data must be access-controlled.
4. Payment flows must avoid exposure of unnecessary sensitive information.
5. Audit trails must be immutable or tamper-evident where feasible.

### 10.5 Observability
1. Every request shall have a correlation/request ID.
2. Every tool call shall be logged.
3. Every provider call shall be observable.
4. Key business events shall be queryable.
5. Error classification shall distinguish:
   - user input error
   - schema error
   - provider failure
   - payment failure
   - translation failure
   - internal system error

### 10.6 Maintainability
1. Schema definitions must be modular.
2. Tool definitions must be modular.
3. Translation keys must be centralized.
4. UI templates must be reusable.
5. Business rules must not be scattered through providers.

---

## 11. UI / UX Requirements

### 11.1 WhatsApp UX Requirements
1. The product shall feel native to WhatsApp.
2. The product shall favor short, clear, actionable messages.
3. Button and list-based interactions shall be preferred for critical flows.
4. The system shall validate against WhatsApp UI limits before sending.
5. The system shall support graceful fallback to plain text if a UI type is unsupported.

### 11.2 UX Design Principles
- reduce typing
- reduce ambiguity
- avoid long conversational loops
- show progress
- maintain trust
- support multilingual readability
- provide human fallback when needed

### 11.3 Missing Field UX
When schema is incomplete, the response should:
- explain what is missing in the user’s language
- offer one-tap options where possible
- minimize the number of steps
- remember previous selections
- support correction/back navigation where reasonable

### 11.4 Confirmation UX
Before expensive or irreversible actions, the system should:
- summarize the selection
- restate price/currency
- restate date/time/location
- present clear confirm/cancel options

### 11.5 Accessibility / Inclusivity
1. TTS should support users with reading or literacy barriers.
2. Messages should avoid unnecessary jargon.
3. Buttons should use concise, understandable labels.
4. Language support should include culturally appropriate translation quality.

---

## 12. Data and Database Requirements

## 12.1 Data Storage Strategy
Use a two-layer strategy:

### Hot State Store (Redis or equivalent)
Used for:
- active session state
- current schema progress
- short-lived tool caches
- pending UI state
- recent context summaries

### Durable Store (Postgres or equivalent)
Used for:
- users
- sessions
- message history
- audit logs
- tool runs
- bookings
- payments
- vendor records
- translations
- preferences
- operator actions

## 12.2 Core Entities
Recommended minimum entities:
- users
- user_profiles
- user_preferences
- user_language_settings
- sessions
- session_state
- messages
- message_translations
- schemas
- schema_versions
- tool_registry
- tool_runs
- provider_integrations
- bookings
- booking_events
- payments
- payment_events
- vendors
- vendor_preferences
- vendor_language_settings
- human_handoffs
- notifications
- audit_logs
- decision_logs
- tts_assets

## 12.3 User Context Model
Context should be structured in three layers:

### Static Profile
- name
- nationality
- preferred language
- home/default location
- preferred currency
- communication preferences

### Behavioral Memory
- recent actions
- frequent services
- common destinations
- preferred vendors
- timing patterns
- past bookings

### Live Session State
- current intent
- current step
- active schema
- missing fields
- pending options
- selected option IDs
- payment/booking progress

## 12.4 Translation Storage Requirements
The system should store:
- original user utterance
- detected language
- translated canonical text
- vendor/API translated form if used
- translation confidence
- translator/provider metadata

## 12.5 Audit and Logging Data Requirements
Every critical event should capture:
- request ID
- session ID
- user ID / phone hash
- action type
- model used
- tool used
- provider used
- execution status
- latency
- error codes
- timestamp

---

## 13. API and Integration Requirements

### 13.1 Internal API Requirements
Internal services/modules shall expose:
- webhook ingress endpoints
- session/context APIs
- orchestrator APIs
- tool execution APIs
- translation/TTS APIs
- admin/operator APIs

### 13.2 Provider Adapter Requirements
Each provider adapter shall define:
- auth method
- capabilities
- required parameters
- response normalization rules
- retry policy
- rate limit policy
- fallback behavior

### 13.3 Tool Registry Requirements
Every tool should include:
- name
- description
- required parameters
- optional parameters
- provider mapping
- execution policy
- idempotency behavior
- permissions / risk level
- schema bindings
- localization notes

### 13.4 MCP Wrapper Requirements
MCP should:
- act as a wrapper/interface layer
- validate contracts
- normalize tool inputs/outputs where helpful
- be removable/replacable without breaking the product logic
- not contain business-critical domain logic that cannot be moved elsewhere

---

## 14. Language, Translation, and Localization Requirements

### 14.1 Supported Language Model
The product must support:
- user-facing language selection/detection
- backend canonical language for schemas/tool logic
- vendor-preferred language
- provider/API language normalization where necessary

### 14.2 Required Translation Behaviors
1. Detect user language on first meaningful message or infer from profile.
2. Normalize requests into a canonical internal format.
3. Translate structured UI labels and error messages.
4. Translate vendor communications when required.
5. Provide auditability of translated content.

### 14.3 Translation Quality Controls
- confidence score for translation
- operator correction where low confidence
- block critical execution on dangerously ambiguous translation where required
- preserve originals for traceability

---

## 15. TTS / Voice Output Requirements

### 15.1 Use Cases
- accessibility support
- onboarding guidance
- booking confirmations
- step-by-step instructions in the user’s language
- optional concierge-style voice summary

### 15.2 TTS Functional Requirements
1. Generate audio from validated final response text.
2. Support configurable voice selection per language.
3. Allow TTS enablement at user profile level.
4. Cache generated audio when appropriate.
5. Store generated TTS asset metadata.
6. Provide fallback to text if TTS fails.

### 15.3 Voice UX Constraints
- TTS must not slow down critical booking flow completion.
- TTS should be optional, not forced.
- TTS should not expose internal system data.

---

## 16. Security, Privacy, and Compliance Requirements

1. Webhook requests shall be verified.
2. Personal data shall be access-controlled.
3. Secrets shall be stored in a proper secrets manager.
4. Sensitive payment references shall not be logged in unsafe form.
5. Audit logs shall be retained according to policy.
6. Translation and TTS providers must be assessed for data handling risks if external.
7. Operator access shall be role-based.
8. Admin actions shall be logged.

---

## 17. Observability and Operations Requirements

### 17.1 Logging
The system shall log:
- inbound webhook receipt
- session load/create
- LLM decision output
- tool validation result
- provider execution
- UI rendering result
- message send result
- booking/payment state changes

### 17.2 Dashboards
Operations should have visibility into:
- message volume
- tool success/failure
- provider latency
- booking funnel
- payment funnel
- translation failure rates
- TTS failure rates
- handoff rates

### 17.3 Manual Controls
Operators should be able to:
- inspect a session
- inspect tool history
- inspect booking/payment state
- resend a message
- trigger fallback
- mark a session for human takeover
- override vendor mapping where necessary

---

## 18. Deployment and Environment Requirements

### 18.1 Environments
The system shall support at minimum:
- local development
- staging
- production

### 18.2 Environment Configuration
Each environment should define:
- Twilio configuration
- DB configuration
- Redis configuration
- LLM credentials
- translation provider credentials
- TTS provider credentials
- Nango credentials
- provider-specific credentials
- feature flags

### 18.3 CI/CD Requirements
- automated tests on pull request
- environment-safe deploy process
- secrets injection from secure store
- migration strategy for DB changes
- rollback plan

---

## 19. Recommended Initial Technical Stack

This document is implementation-agnostic, but the current recommended stack for speed and maintainability is:

- WhatsApp channel via Twilio
- backend API on Cloud Run or equivalent
- Postgres as durable store
- Redis as hot state/cache
- one fast LLM for decision/UI support
- MCP-style tool interface layer
- Nango for auth/proxy/normalization where appropriate
- provider adapters for hotels/payments/transport
- deterministic WhatsApp renderer

---

## 20. First Vertical: Hotel Search and Booking End-to-End

### 20.1 User Flow
1. User types or taps intent.
2. System narrows intent if necessary.
3. System collects missing schema (location/date/guests etc.) with WhatsApp UI.
4. System calls `search_hotels` tool.
5. Tool interface validates call.
6. Nango/provider returns normalized results.
7. System renders hotel cards/buttons.
8. User selects hotel.
9. System initiates booking.
10. System initiates payment.
11. System confirms booking.
12. System updates durable state and optionally schedules reminders.

### 20.2 Phase 1 Acceptance Criteria
- hotel search works via text or UI
- missing fields are collected through WhatsApp UI
- multilingual prompts work for supported languages
- normalized hotel results are displayed correctly
- booking initiation works
- payment initiation works
- all steps are logged and recoverable

---

## 21. Suggested Schema Structure

```json
{
  "schema_name": "search_hotels",
  "version": "1.0",
  "required_fields": ["location", "checkin_date"],
  "optional_fields": ["checkout_date", "guests", "budget", "currency"],
  "fields": {
    "location": {
      "type": "location_or_text",
      "ui": {
        "prompt_key": "hotel.location.prompt",
        "mode": "list_or_text"
      },
      "validation": {
        "required": true
      }
    },
    "checkin_date": {
      "type": "date",
      "ui": {
        "prompt_key": "hotel.checkin.prompt",
        "mode": "buttons",
        "options": ["today", "tomorrow", "pick_date"]
      },
      "validation": {
        "required": true
      }
    },
    "guests": {
      "type": "integer",
      "ui": {
        "prompt_key": "hotel.guests.prompt",
        "mode": "buttons",
        "options": ["1", "2", "3", "4+"]
      }
    }
  }
}
```

---

## 22. Suggested Decision Output Contract

```json
{
  "intent": "search_hotels",
  "parameters": {
    "location": "Galle"
  },
  "missing_fields": ["checkin_date"],
  "suggested_action": "ask_missing",
  "confidence": 0.93
}
```

---

## 23. Suggested Tool Call Contract

```json
{
  "tool": "search_hotels",
  "params": {
    "location": "Galle",
    "checkin_date": "2026-04-17",
    "checkout_date": "2026-04-18",
    "guests": 1,
    "currency": "GBP"
  },
  "context": {
    "user_language": "en",
    "canonical_language": "en",
    "session_id": "sess_123",
    "request_id": "req_456"
  }
}
```

---

## 24. Suggested WhatsApp UI Response Contract

```json
{
  "messages": [
    {
      "type": "text",
      "body": "When are you checking in?"
    },
    {
      "type": "buttons",
      "buttons": [
        { "id": "checkin_today", "title": "Today" },
        { "id": "checkin_tomorrow", "title": "Tomorrow" },
        { "id": "checkin_custom", "title": "Pick date" }
      ]
    }
  ]
}
```

---

## 25. QA and Acceptance Requirements

QA must validate:
- text-first flows
- button-first flows
- mixed language flows
- missing schema flows
- booking/payment retries
- duplicate webhook handling
- translation fallback
- TTS generation and fallback
- human handoff trigger paths
- provider outage behavior

---

## 26. Risks and Mitigations

### Risk: Over-reliance on LLM in critical path
Mitigation: backend-owned state machine, deterministic renderer, validated contracts

### Risk: Translation errors causing bad execution
Mitigation: canonical schema, confidence scoring, operator fallback, preserve originals

### Risk: Provider variance / API instability
Mitigation: Nango/adapters, normalization, retries, provider abstraction, caching

### Risk: WhatsApp UX becoming rigid
Mitigation: dual entry mode, natural language overlay, skip questions when enough info exists

### Risk: Operational complexity
Mitigation: audit logs, manual override tools, narrow initial vertical

---

## 27. Final Product Direction

The system must be built as a **production-grade orchestration platform** whose defining characteristics are:

- WhatsApp-native interaction
- state-aware backend control
- schema-driven flows
- one primary LLM for assistive reasoning
- MCP as interface wrapper where appropriate
- Nango/direct adapters for external service execution
- multilingual interaction and translation support
- optional text-to-speech support
- reliable bookings/payments/vendor coordination
- strong auditability and recoverability

This is the approved implementation direction for engineering planning and execution.

---

## 28. Appendix A — Implementation Notes for Engineering

1. Start with one vertical: hotels.
2. Keep one LLM in two prompt modes rather than multiple LLMs.
3. Use deterministic UI rendering for common flows.
4. Treat WhatsApp UI as schema, not just as front-end decoration.
5. Keep MCP thin and replaceable.
6. Keep Nango optional per provider, but standardize its role where used.
7. Store durable truth outside Redis.
8. Log everything important.
9. Build multilingual support into the data model from day one.
10. Add TTS through an abstraction, not as a hard-coded provider dependency.

## Master Admin Interface Requirements

The platform SHALL provide a secure, role-based **Master Admin Interface** for internal operators and authorized administrators to centrally configure, monitor, and control all major aspects of the system without requiring engineering intervention for routine operations.

### Core Capabilities
The Master Admin Interface SHALL support:

- **Global configuration management**
  - Enable, disable, or modify system-wide settings
  - Configure default behavior for orchestration, schema flows, routing logic, retries, fallbacks, caching, and timeout thresholds
  - Adjust performance-related controls such as rate limits, queue thresholds, response time targets, model usage policies, and execution priorities

- **Vertical and product management**
  - Add, edit, enable, disable, or remove service verticals (e.g. hotels, transport, tours, restaurants, retail, emergency)
  - Manage vertical-specific schemas, workflows, UI prompts, required fields, optional fields, and validation rules
  - Control rollout by environment, region, vendor group, or user segment

- **Vendor and partner management**
  - Add, edit, suspend, reactivate, or remove vendors and partner organizations
  - Manage vendor profiles, languages, categories, coverage areas, operating hours, service offerings, SLAs, quota/capacity, and fallback preferences
  - Monitor vendor performance, response rates, booking success, fulfillment quality, cancellation rates, and reliability scores

- **API and integration management**
  - Add, edit, enable, disable, or remove APIs, providers, connectors, and third-party integrations
  - Configure MCP tool mappings, provider routing rules, normalization settings, authentication references, and provider failover priorities
  - View integration health, latency, success/failure rates, webhook status, token expiry warnings, and error logs

- **Operational controls**
  - View and manage live sessions, user journeys, pending actions, tool calls, bookings, payments, escalations, and failures
  - Retry, cancel, override, re-route, or manually intervene in workflows where needed
  - Trigger human handoff and operator assignment for exceptional cases

- **Reporting and analytics**
  - Access dashboards and exportable reports for bookings, revenue, vendor performance, conversion funnels, user engagement, API performance, language usage, latency, errors, payment completion, and operational KPIs
  - Support filtering by date range, vertical, region, vendor, language, integration, and workflow type

- **Content, UI, and UX control**
  - Update WhatsApp UI templates, button sets, quick replies, carousel content, list messages, multilingual content, TTS settings, and fallback prompts
  - Manage schema-driven UI behavior for missing fields so administrators can adjust how the system collects required user data without code changes

- **Performance tuning and experimentation**
  - Adjust orchestration policies, prompt variants, model selection rules, cache TTLs, confidence thresholds, ranking strategies, and retry behavior
  - Support feature flags, staged rollouts, A/B testing, and safe configuration experiments

- **Security and access control**
  - Enforce role-based access control (RBAC) with permissions for super admin, operations admin, vendor admin, finance admin, support admin, and analyst roles
  - Maintain full audit logs for all admin actions, configuration changes, overrides, and sensitive operations
  - Protect sensitive credentials and integration secrets through secure secret management and restricted visibility

### Non-Functional Requirements
- The Master Admin Interface SHOULD be web-based, responsive, and optimized for desktop-first internal operations
- The interface MUST expose only authorized controls based on role and permissions
- All critical configuration changes MUST be logged with user, timestamp, old value, and new value
- The interface SHOULD support safe rollback of critical configuration changes
- The interface MUST not require direct database access for normal business operations
- The interface SHOULD be designed so that most routine changes to vendors, APIs, schemas, UI flows, and performance settings can be handled operationally without code deployment

## Vendor CMS Through WhatsApp Requirements

The platform SHALL provide a **Vendor CMS through WhatsApp** so that vendors can operate, respond to requests, manage availability, and update key business information without requiring a separate web or mobile application.

### Purpose
The Vendor CMS SHALL allow vendors to use WhatsApp as their primary operational interface, especially in low-friction environments where vendors may not have access to advanced dashboards, APIs, or dedicated software systems.

### Core Capabilities
The Vendor WhatsApp CMS SHALL support:

- **Vendor onboarding and identity**
  - Register vendors and associate them with one or more WhatsApp numbers
  - Link vendor WhatsApp accounts to vendor profiles in the platform
  - Support verification and approval of vendor accounts before activation

- **Structured request handling**
  - Receive structured service requests through WhatsApp in a clear, vendor-friendly format
  - Allow vendors to respond using buttons, quick replies, and guided prompts where supported
  - Support the following core response actions:
    - Accept
    - Decline
    - Suggest alternative
    - Mark unavailable
    - Request clarification

- **Availability and quota management**
  - Allow vendors to update daily or time-based capacity, quotas, available slots, blackout periods, and stock/service availability directly through WhatsApp-driven flows
  - Support predefined structured commands or guided menu flows for availability updates
  - Sync vendor-submitted quota or availability data into the platform state and routing logic

- **Offer and pricing management**
  - Allow vendors to update service offerings, pricing, packages, inclusions, operating hours, and temporary promotions through WhatsApp workflows
  - Support approval or moderation workflows for sensitive commercial changes where required

- **Booking and fulfillment workflow**
  - Notify vendors of new bookings, soft reservations, confirmations, cancellations, modifications, and customer updates
  - Allow vendors to confirm fulfillment status, mark customer arrival, mark service completed, or report exceptions
  - Support operational follow-ups such as pickup readiness, check-in readiness, and issue escalation

- **Language support**
  - The Vendor WhatsApp CMS SHALL support multilingual operation
  - User-facing requests MAY be translated into the vendor’s preferred language before presentation
  - Vendor responses MAY be translated back into the platform’s normalized internal format and then into the user’s language where needed
  - The system MUST preserve canonical structured values internally regardless of display language

- **Escalation and support**
  - Allow vendors to request human support, flag issues, report booking conflicts, or escalate operational problems through WhatsApp
  - Route escalations to the internal operations team or admin dashboard

### Interaction Model
The Vendor CMS SHALL use WhatsApp as a **structured CMS interface**, not just a plain-text chat channel.

This means the system SHOULD provide:
- guided menu flows
- quick reply options
- button-based actions
- list-based selections
- structured update prompts
- controlled input flows for key operational data

### Integration with Core Platform
The Vendor WhatsApp CMS MUST integrate with:
- vendor profiles and vendor master data
- quota and inventory systems
- orchestration and routing logic
- booking lifecycle management
- audit logs and operational monitoring
- multilingual translation services where needed

### Operational Requirements
- Vendor-originated WhatsApp actions MUST be validated and mapped to authorized vendor accounts
- All vendor actions MUST be logged in the audit trail
- Vendor responses SHOULD update system state in near real time where operationally necessary
- The system SHOULD support fallback to manual operations or internal admin override if a vendor flow fails
- The platform SHOULD allow some vendors to operate exclusively via WhatsApp while others may later use APIs, dashboards, or POS integrations

### Strategic Requirement
The Vendor CMS through WhatsApp MUST be treated as a first-class operational channel because many vendors may initially rely on WhatsApp rather than formal APIs or software platforms.

This capability SHALL reduce onboarding friction, lower training requirements, and allow the platform to scale supply operations even when vendors are not digitally mature.