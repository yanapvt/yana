# Design Document: YANA / OGO Platform

## Overview

YANA / OGO is a WhatsApp-first AI orchestration platform for tourism and real-world service domains. It is a state-aware orchestration engine that uses WhatsApp as the primary user interface, backend-controlled state and context, schema-driven workflows, one primary LLM for decision support, MCP-style tool calling as an interface layer, and Nango as the integration/auth/normalization layer.

The core principle is: **LLM decides; backend executes.** The LLM may infer intent, extract parameters, suggest the next step, and format UI-supporting content, but all critical execution remains under backend control.

---

## Architecture

### Logical Flow

```
User → WhatsApp → Twilio/WhatsApp Business API
  → AI Gateway (signature validation, rate limiting, session initiation)
  → State/Context Layer (Redis hot state + Postgres durable state)
  → Orchestrator / Schema Engine (intent, missing fields, state transitions)
  → LLM (decision mode / UI-support mode)
  → MCP Tool Interface (contract validation, routing, logging)
  → Nango / Provider Adapters (OAuth, normalization, retries)
  → External APIs / Vendors / Payment Providers
  → WhatsApp Renderer (deterministic formatting, UI validation)
  → WhatsApp delivery
```

### Component Responsibilities

#### AI Gateway
- Validates inbound webhook signatures
- Applies rate limiting and abuse detection
- Assigns Correlation IDs to every request
- Emits immediate acknowledgement to user
- Normalizes inbound messages

#### State and Context Layer
- Hot session state in Redis (active schema progress, pending UI state, short-lived caches)
- Durable state in Postgres (users, sessions, messages, bookings, payments, audit logs)
- Assembles context packages for the Orchestrator (user profile, behavioral summary, active flow state)

#### Orchestrator / Schema Engine
- Determines current intent and mode
- Identifies required and missing schema fields
- Decides whether to ask UI questions or execute a tool
- Maintains state transitions and enforces business rules
- Validates all LLM outputs before acting on them

#### LLM Layer
- Decision mode: produces structured output (intent, parameters, missing fields, suggested action, confidence)
- UI-support mode: generates wording and formatting for non-critical content
- Does not directly execute side effects, tool calls, bookings, or payments

#### MCP Tool Interface
- Validates tool calls against registered contracts
- Normalizes tool inputs and outputs at the interface boundary
- Routes tool calls to correct internal adapters
- Logs all tool calls with Correlation IDs
- Returns structured error states on failure

#### Nango / Provider Adapters
- Manages provider credentials, OAuth, and token refresh
- Handles provider-specific normalization, retries, and rate limits
- Replaceable per provider without affecting Orchestrator or Schema Engine

#### WhatsApp Renderer
- Deterministic, WhatsApp-safe message formatting
- Validates against WhatsApp UI limits (button counts, list limits, text lengths)
- Multilingual message generation
- Falls back to plain text when a UI type is unsupported

#### Operations Layer
- Audit logs and decision logs
- Replay / retry tools
- Manual override and human handoff
- Admin interface and vendor tools

---

## Data Model

### Storage Strategy

**Hot State Store (Redis):** Active session state, current schema progress, short-lived tool caches, pending UI state, recent context summaries.

**Durable Store (Postgres):** Users, sessions, message history, audit logs, tool runs, bookings, payments, vendor records, translations, preferences, operator actions.

### Core Entities

- `users`, `user_profiles`, `user_preferences`, `user_language_settings`
- `sessions`, `session_state`
- `messages`, `message_translations`
- `schemas`, `schema_versions`
- `tool_registry`, `tool_runs`
- `provider_integrations`
- `bookings`, `booking_events`
- `payments`, `payment_events`
- `vendors`, `vendor_preferences`, `vendor_language_settings`
- `human_handoffs`
- `notifications`
- `audit_logs`, `decision_logs`
- `tts_assets`

### User Context Model

Three-layer context structure:

1. **Static Profile:** name, nationality, preferred language, home/default location, preferred currency, communication preferences
2. **Behavioral Memory:** recent actions, frequent services, common destinations, preferred vendors, timing patterns, past bookings
3. **Live Session State:** current intent, current step, active schema, missing fields, pending options, selected option IDs, payment/booking progress

---

## Schema System

Every tool-supported workflow is backed by a versioned schema definition. Example structure:

```json
{
  "schema_name": "search_hotels",
  "version": "1.0",
  "required_fields": ["location", "checkin_date"],
  "optional_fields": ["checkout_date", "guests", "budget", "currency"],
  "fields": {
    "location": {
      "type": "location_or_text",
      "ui": { "prompt_key": "hotel.location.prompt", "mode": "list_or_text" },
      "validation": { "required": true }
    },
    "checkin_date": {
      "type": "date",
      "ui": {
        "prompt_key": "hotel.checkin.prompt",
        "mode": "buttons",
        "options": ["today", "tomorrow", "pick_date"]
      },
      "validation": { "required": true }
    }
  }
}
```

---

## LLM Decision Contract

The LLM decision mode produces a structured output:

```json
{
  "intent": "search_hotels",
  "parameters": { "location": "Galle" },
  "missing_fields": ["checkin_date"],
  "suggested_action": "ask_missing",
  "confidence": 0.93
}
```

---

## Tool Call Contract

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

## WhatsApp UI Response Contract

```json
{
  "messages": [
    { "type": "text", "body": "When are you checking in?" },
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

## Hotel Search and Booking Flow (First Vertical)

1. User types or taps intent
2. Orchestrator narrows intent if necessary
3. Schema Engine collects missing fields (location, dates, guests) via WhatsApp UI
4. MCP Interface executes `search_hotels` tool
5. Provider Adapter returns normalized results via Nango
6. WhatsApp Renderer formats hotel cards with Book Now / More Info actions
7. User selects hotel
8. Booking Manager initiates booking (hold if supported, then payment)
9. Payment Manager initiates payment (telco billing or payment link)
10. Booking Manager confirms booking after provider confirmation + payment success
11. Durable state updated; optional proactive reminders scheduled

---

## Booking State Machine

Valid booking states and transitions:

```
initiated → hold_requested → hold_confirmed → payment_pending → confirmed
initiated → payment_pending → confirmed
any_state → cancelled
any_state → timed_out
```

---

## Payment State Machine

Valid payment states:

```
initiated → pending → succeeded → (booking confirmed)
initiated → pending → failed → (user notified)
initiated → pending → timed_out → (booking timed_out)
succeeded → refunded_or_cancelled
```

---

## Vendor CMS (WhatsApp)

Vendors interact with the platform through structured WhatsApp flows:
- Receive booking requests in their preferred language
- Respond with Accept / Decline / Suggest alternative / Mark unavailable / Request clarification
- Update availability, quotas, pricing, and offerings through guided menu flows
- Receive booking notifications and confirm fulfillment status
- Escalate issues to internal operations team

All vendor actions are validated against the vendor's authorized account and logged in the audit trail.

---

## Master Admin Interface

Web-based, role-based interface for internal operators. Supports:
- Global configuration management (orchestration, schemas, routing, retries, fallbacks)
- Vertical and product management (add/edit/enable/disable verticals and schemas)
- Vendor and partner management
- API and integration management
- Live operational controls (view/retry/cancel/override sessions, bookings, payments)
- Reporting and analytics dashboards
- Content and UI management (WhatsApp templates, multilingual content, TTS settings)
- Performance tuning and feature flags
- RBAC with roles: super admin, operations admin, vendor admin, finance admin, support admin, analyst

---

## Multilingual and Translation Design

- Language detected on first meaningful message or inferred from user profile
- All user utterances normalized to Canonical_Form for schema processing
- WhatsApp UI labels, messages, and confirmations translated to user's preferred language
- Vendor communications translated to vendor's preferred language
- Translation records stored: original utterance, detected language, translated text, Canonical_Form, confidence, translator metadata
- Low-confidence translations flagged for operator review
- Operator can override mistranslations through Admin Interface

---

## TTS Design

- Audio generated from final validated response text only (never raw LLM output)
- Delivered as WhatsApp voice note, media link, or audio attachment
- Configurable at user profile level and message type level
- Non-blocking: TTS generation does not delay critical booking/payment flows
- Fallback to text if TTS generation fails
- Generated assets cached to avoid redundant generation

---

## Security Design

- Webhook signature validation on every inbound request
- Secrets stored in secure secrets manager
- Personal data access-controlled by role
- Payment references not logged in unprotected form
- Audit logs retained per policy
- All admin actions logged with user, timestamp, old value, new value
- RBAC enforced on Admin Interface

---

## Observability Design

- Every request assigned a unique Correlation_ID propagated through all downstream steps
- Every tool call logged: Correlation_ID, tool name, input, output, status, timestamp
- Every provider call logged: Correlation_ID, provider name, request, response, status, latency
- Key business events queryable: session creation, LLM decision, schema completion, booking/payment state changes
- Error classification: user input error, schema error, provider failure, payment failure, translation failure, internal system error

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

### Property 1: Webhook Signature Validation

*For any* inbound webhook request, the AI_Gateway SHALL accept the request if and only if the signature is valid; requests with invalid signatures SHALL be rejected and logged.

**Validates: Requirements 1.1, 1.2**

---

### Property 2: Session State Round-Trip

*For any* user session with stored state (active schema, conversation history, flow progress), sending a new message SHALL result in the Session_Manager loading and returning a context package that contains all previously stored state components.

**Validates: Requirements 1.4, 1.8, 16.3**

---

### Property 3: Message History Persistence

*For any* processed message, querying the conversation history for that session SHALL return the message with its original content and metadata.

**Validates: Requirements 1.6, 16.2**

---

### Property 4: Schema Field Collection Completeness

*For any* schema with one or more missing required fields, the Schema_Engine SHALL generate a prompt for each missing field, and once all required fields are collected, the Schema_Engine SHALL not generate further field prompts for already-supplied fields.

**Validates: Requirements 2.4, 2.7, 3.3**

---

### Property 5: Schema Bypass on Complete Input

*For any* user input that already supplies all required schema fields, the Orchestrator SHALL proceed to tool execution without generating UI narrowing or field collection prompts.

**Validates: Requirements 2.3, 9.3 (schema section)**

---

### Property 6: Schema Version Compatibility

*For any* active session referencing a specific schema version, updating the schema to a new version SHALL not invalidate the session's ability to complete its flow using the referenced version.

**Validates: Requirements 3.4, 3.5**

---

### Property 7: LLM Decision Output Structure

*For any* user input processed in decision mode, the LLM output SHALL be a structured object containing intent, extracted parameters, identified missing fields, suggested next action, and confidence metadata.

**Validates: Requirements 4.1**

---

### Property 8: LLM Output Validation Before Execution

*For any* LLM decision output, the Orchestrator SHALL validate the output against schema and business rules before taking any action; invalid LLM outputs SHALL not result in tool execution, booking, or payment actions.

**Validates: Requirements 4.3, 4.4**

---

### Property 9: Low-Confidence LLM Fallback

*For any* LLM decision output with confidence below the configured threshold, the Orchestrator SHALL respond with UI-based narrowing rather than proceeding with execution.

**Validates: Requirements 4.5**

---

### Property 10: Tool Call Contract Validation

*For any* tool call, the MCP_Interface SHALL validate the call against the tool's registered contract; calls that fail validation SHALL not be executed and SHALL return a structured error state.

**Validates: Requirements 5.1, 5.4**

---

### Property 11: Tool Call Logging Completeness

*For any* tool call (successful or failed), the MCP_Interface SHALL create a log entry containing the Correlation_ID, tool name, input parameters, output or error, execution status, and timestamp.

**Validates: Requirements 5.3, 17.2**

---

### Property 12: Tool Call Retry Policy

*For any* failed tool call where the tool's execution policy specifies a retry count greater than zero, the MCP_Interface SHALL retry the call up to the configured number of times before returning a final failure state.

**Validates: Requirements 5.5, 21.3**

---

### Property 13: Provider Failure Structured Response

*For any* provider call that exhausts its retry policy, the Provider_Adapter SHALL return a structured failure state to the MCP_Interface containing the error classification and relevant context.

**Validates: Requirements 6.2, 6.6**

---

### Property 14: Hotel Result Normalization and Rendering

*For any* hotel search result returned by a provider, the System SHALL normalize it into the internal hotel result schema and the WhatsApp_Renderer SHALL produce a formatted message containing hotel name, price, currency, rating, review count, location, distance, amenities, cancellation policy, and Book Now / More Info actions.

**Validates: Requirements 7.4, 7.5, 7.6**

---

### Property 15: WhatsApp UI Limit Compliance

*For any* outbound WhatsApp message, the WhatsApp_Renderer SHALL validate the message against WhatsApp UI limits (button counts, list item counts, text lengths) before delivery; messages that exceed limits SHALL be reformatted or fall back to plain text.

**Validates: Requirements 7.7, 15.1, 15.2**

---

### Property 16: Booking State Machine Validity

*For any* booking, all state transitions SHALL follow the defined booking state machine; invalid state transitions SHALL be rejected and the booking SHALL remain in its current state.

**Validates: Requirements 8.2, 8.3**

---

### Property 17: Booking Audit Trail Completeness

*For any* booking state transition, the Booking_Manager SHALL record a booking event in the Durable_Store containing the booking ID, previous state, new state, triggering action, and timestamp.

**Validates: Requirements 8.7**

---

### Property 18: Booking and Payment Idempotency

*For any* booking initiation, payment initiation, or webhook callback processed multiple times with the same identifier, the System SHALL produce the same outcome as a single processing and SHALL not create duplicate records, charges, or state updates.

**Validates: Requirements 8.8, 9.6, 9.7, 21.1, 21.2**

---

### Property 19: Payment State Machine Validity

*For any* payment, all state transitions SHALL follow the defined payment state machine; invalid state transitions SHALL be rejected and the payment SHALL remain in its current state.

**Validates: Requirements 9.4, 9.5, 9.8**

---

### Property 20: Translation Round-Trip and Storage

*For any* user utterance that requires translation, the Translation_Service SHALL produce a Canonical_Form and the System SHALL store the original utterance, detected language, translated text, Canonical_Form, translation confidence, and translator metadata as a complete translation record.

**Validates: Requirements 10.3, 10.7, 16.5**

---

### Property 21: User Language Preference Persistence

*For any* user with a stored language preference, all subsequent WhatsApp UI labels, messages, and confirmations rendered for that user SHALL be in the user's preferred language.

**Validates: Requirements 10.2, 10.4**

---

### Property 22: Low-Confidence Translation Fallback

*For any* translation with confidence below the configured threshold, the Orchestrator SHALL apply multilingual fallback behavior and the System SHALL flag the message for operator review rather than proceeding with low-confidence execution.

**Validates: Requirements 10.8**

---

### Property 23: TTS Source Integrity

*For any* TTS generation request, the TTS_Service SHALL generate audio only from the final validated response text; the input to TTS SHALL never be raw LLM output or unvalidated content.

**Validates: Requirements 11.7**

---

### Property 24: TTS Failure Fallback

*For any* TTS generation failure, the System SHALL deliver the text response to the user without audio and SHALL log the TTS failure with the Correlation_ID; the failure SHALL not block or delay the delivery of the text response.

**Validates: Requirements 11.6, 11.5**

---

### Property 25: TTS Caching Idempotency

*For any* TTS generation request for text that has already been generated and cached, the TTS_Service SHALL return the cached asset rather than generating a new one, and the returned asset SHALL be equivalent to the originally generated asset.

**Validates: Requirements 11.8**

---

### Property 26: Correlation ID Propagation

*For any* inbound request, the Correlation_ID assigned by the AI_Gateway SHALL appear in every downstream log entry (tool call logs, provider call logs, audit log entries, error logs) associated with that request.

**Validates: Requirements 17.1**

---

### Property 27: Audit Log Completeness

*For any* critical event (session creation, LLM decision, schema completion, tool execution, provider call, booking state change, payment state change), the System SHALL create an audit log entry containing request ID, session ID, user ID or phone hash, action type, model used, tool used, provider used, execution status, latency, error codes, and timestamp.

**Validates: Requirements 16.6, 17.4**

---

### Property 28: Error Classification

*For any* system error, the System SHALL classify the error into exactly one of the defined categories: user input error, schema error, provider failure, payment failure, translation failure, or internal system error.

**Validates: Requirements 17.5**

---

### Property 29: Vendor Action Authorization

*For any* vendor-originated WhatsApp action, the Vendor_CMS SHALL validate the action against the vendor's authorized account before processing; actions from unrecognized or unauthorized accounts SHALL be rejected and logged.

**Validates: Requirements 20.11, 20.12**

---

### Property 30: Vendor Availability Sync

*For any* vendor availability or quota update submitted through the Vendor_CMS, the updated values SHALL be reflected in the platform's routing and scheduling state within the configured near-real-time window.

**Validates: Requirements 20.6**
