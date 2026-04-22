# Implementation Plan: YANA / OGO Platform

## Overview

Incremental implementation of the YANA / OGO WhatsApp-first AI orchestration platform in TypeScript (Node.js). Each task builds on the previous, wiring components together progressively. The stack targets Node.js + TypeScript with Postgres (Durable_Store), Redis (State_Store), and Twilio for WhatsApp delivery.

---

## Tasks

- [x] 1. Project scaffold and core type definitions
  - Initialise a Node.js + TypeScript monorepo (or single-service) project with `tsconfig.json`, `package.json`, ESLint, and Prettier
  - Define core TypeScript interfaces and types: `InboundMessage`, `Session`, `UserProfile`, `SchemaDefinition`, `SchemaField`, `LLMDecisionOutput`, `ToolCallRequest`, `ToolCallResult`, `BookingRecord`, `PaymentRecord`, `AuditLogEntry`, `CorrelationContext`
  - Define enums: `BookingState`, `PaymentState`, `ErrorCategory`, `IntentMode`
  - Set up environment configuration loader (reads from `.env` / secrets store) for Twilio, Postgres, Redis, LLM, translation, TTS, Nango, and feature flags
  - _Requirements: 22.1, 22.2, 23.1, 23.2, 23.3_

- [x] 2. Database layer — Postgres migrations and data access
  - [x] 2.1 Write Postgres migration files for all core entities
    - Create tables: `users`, `user_profiles`, `user_preferences`, `user_language_settings`, `sessions`, `session_state`, `messages`, `message_translations`, `schemas`, `schema_versions`, `tool_registry`, `tool_runs`, `provider_integrations`, `bookings`, `booking_events`, `payments`, `payment_events`, `vendors`, `vendor_preferences`, `vendor_language_settings`, `human_handoffs`, `notifications`, `audit_logs`, `decision_logs`, `tts_assets`
    - Include indexes for session lookup, user lookup, booking/payment state queries, and Correlation_ID queries
    - _Requirements: 16.2, 16.4, 16.5, 16.6, 23.5_

  - [x] 2.2 Implement typed data-access repository classes for each entity group
    - `UserRepository`, `SessionRepository`, `MessageRepository`, `SchemaRepository`, `ToolRepository`, `BookingRepository`, `PaymentRepository`, `AuditRepository`
    - All writes must be idempotent where applicable
    - _Requirements: 16.2, 21.2_

  - [x] 2.3 Write unit tests for repository classes
    - Test create, read, update, and upsert operations against a test database
    - _Requirements: 16.2_

- [x] 3. Redis State_Store layer
  - [x] 3.1 Implement `StateStore` service wrapping Redis
    - Methods: `setSessionState`, `getSessionState`, `deleteSessionState`, `setToolCache`, `getToolCache`
    - TTL-based expiry for hot session state
    - _Requirements: 16.1, 16.3_

  - [x] 3.2 Write unit tests for StateStore
    - Test set/get/expiry/fallback behaviour
    - _Requirements: 16.1, 16.3_

- [x] 4. AI Gateway — inbound webhook handler
  - [x] 4.1 Implement the Twilio webhook ingress endpoint (`POST /webhook/whatsapp`)
    - Validate Twilio webhook signature on every request (reject and log invalid signatures with Correlation_ID)
    - Assign a unique `Correlation_ID` to every inbound request
    - Normalise inbound message into `InboundMessage` type (text, media, audio, button reply, list reply)
    - Emit immediate acknowledgement response to Twilio (HTTP 200) before expensive processing
    - Apply rate limiting and abuse detection middleware
    - _Requirements: 1.1, 1.2, 1.5, 1.7, 18.1_

  - [x] 4.2 Write property test for webhook signature validation (Property 1)
    - **Property 1: Webhook Signature Validation**
    - **Validates: Requirements 1.1, 1.2**

  - [x] 4.3 Implement deduplication middleware for inbound webhook deliveries
    - Use Redis to track processed message IDs; skip duplicate deliveries
    - _Requirements: 21.1_

- [x] 5. Session Manager
  - [x] 5.1 Implement `SessionManager` service
    - `createSession(user)`: creates user + session records in Durable_Store
    - `resumeSession(phoneNumber)`: loads session from State_Store, falls back to Durable_Store
    - `assembleContextPackage(sessionId)`: returns user profile, behavioral summary, active flow state, schema progress
    - `appendMessage(sessionId, message)`: persists message to Durable_Store and updates State_Store
    - _Requirements: 1.3, 1.4, 1.6, 1.8, 16.3_

  - [x] 5.2 Write property test for session state round-trip (Property 2)
    - **Property 2: Session State Round-Trip**
    - **Validates: Requirements 1.4, 1.8, 16.3**

  - [x] 5.3 Write property test for message history persistence (Property 3)
    - **Property 3: Message History Persistence**
    - **Validates: Requirements 1.6, 16.2**

- [x] 6. Schema Registry and Schema Engine
  - [x] 6.1 Implement `SchemaRepository` with versioned schema storage
    - Store and retrieve `SchemaDefinition` records by name and version
    - Support schema versioning so active sessions reference the version at session start
    - _Requirements: 3.1, 3.4, 3.5_

  - [x] 6.2 Implement `SchemaEngine` service
    - `getMissingFields(schema, collectedFields)`: returns list of missing required fields
    - `validateFields(schema, fields)`: validates all field values against schema rules
    - `generateFieldPrompt(field, userLanguage)`: returns WhatsApp UI prompt descriptor for a missing field
    - `isComplete(schema, fields)`: returns true when all required fields are satisfied
    - Enforce field collection order, optional shortcuts, and conditional fields
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 3.2, 3.3_

  - [x] 6.3 Write property test for schema field collection completeness (Property 4)
    - **Property 4: Schema Field Collection Completeness**
    - **Validates: Requirements 2.4, 2.7, 3.3**

  - [x] 6.4 Write property test for schema bypass on complete input (Property 5)
    - **Property 5: Schema Bypass on Complete Input**
    - **Validates: Requirements 2.3, 3.3**

  - [x] 6.5 Write property test for schema version compatibility (Property 6)
    - **Property 6: Schema Version Compatibility**
    - **Validates: Requirements 3.4, 3.5**

- [x] 7. LLM Decision Layer
  - [x] 7.1 Implement `LLMService` with decision mode and UI-support mode
    - `decide(contextPackage, userMessage)`: calls LLM and returns `LLMDecisionOutput` (intent, parameters, missing fields, suggested action, confidence)
    - `generateUIContent(prompt, userLanguage)`: UI-support mode for wording/formatting non-critical content
    - LLM must not directly trigger tool calls, bookings, or payments
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 7.2 Implement LLM output validation in `Orchestrator`
    - Validate `LLMDecisionOutput` against schema and business rules before any action
    - If confidence is below configured threshold, return UI-narrowing response instead of proceeding
    - _Requirements: 4.4, 4.5_

  - [x] 7.3 Write property test for LLM decision output structure (Property 7)
    - **Property 7: LLM Decision Output Structure**
    - **Validates: Requirements 4.1**

  - [x] 7.4 Write property test for LLM output validation before execution (Property 8)
    - **Property 8: LLM Output Validation Before Execution**
    - **Validates: Requirements 4.3, 4.4**

  - [x] 7.5 Write property test for low-confidence LLM fallback (Property 9)
    - **Property 9: Low-Confidence LLM Fallback**
    - **Validates: Requirements 4.5**

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. MCP Tool Interface
  - [x] 9.1 Implement `ToolRegistry` — load and store tool definitions from Durable_Store
    - Each tool definition includes: name, description, required/optional parameters, provider mapping, execution policy (retry count, idempotency), permissions, schema bindings
    - Support adding new tools without modifying Orchestrator
    - _Requirements: 5.6, 5.7, 22.1, 22.2_

  - [x] 9.2 Implement `MCPInterface` service
    - `executeToolCall(toolCallRequest, correlationCtx)`: validates against registered contract, normalises input, routes to correct adapter, logs call, returns `ToolCallResult`
    - On validation failure: return structured error state, do not execute
    - On execution failure: apply retry policy from tool definition, return final failure state after exhausting retries
    - Log every call (success or failure) with Correlation_ID, tool name, input, output, status, timestamp
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 9.3 Write property test for tool call contract validation (Property 10)
    - **Property 10: Tool Call Contract Validation**
    - **Validates: Requirements 5.1, 5.4**

  - [x] 9.4 Write property test for tool call logging completeness (Property 11)
    - **Property 11: Tool Call Logging Completeness**
    - **Validates: Requirements 5.3, 17.2**

  - [x] 9.5 Write property test for tool call retry policy (Property 12)
    - **Property 12: Tool Call Retry Policy**
    - **Validates: Requirements 5.5, 21.3**

- [x] 10. Nango / Provider Adapter layer
  - [x] 10.1 Implement `NangoAdapter` base class and `ProviderAdapter` interface
    - `NangoAdapter`: wraps Nango SDK for credential storage, OAuth, token refresh
    - `ProviderAdapter` interface: `execute(params)`, `normaliseResponse(raw)`, `getRetryPolicy()`
    - Adapters are replaceable without changing MCPInterface or Orchestrator
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 10.2 Implement structured failure state return on provider exhaustion
    - After exhausting retry policy, return `ProviderFailureState` with error classification and context
    - _Requirements: 6.6, 13.2_

  - [x] 10.3 Write property test for provider failure structured response (Property 13)
    - **Property 13: Provider Failure Structured Response**
    - **Validates: Requirements 6.2, 6.6**

- [x] 11. Translation Service
  - [x] 11.1 Implement `TranslationService`
    - `detectLanguage(text)`: detect language from user message
    - `toCanonicalForm(text, sourceLang)`: normalise to Canonical_Form for schema/tool processing
    - `translate(text, targetLang)`: translate text to target language
    - `storeTranslationRecord(sessionId, record)`: persist original, detected lang, translated text, Canonical_Form, confidence, metadata
    - _Requirements: 10.1, 10.3, 10.7_

  - [x] 11.2 Implement language preference persistence and application
    - Store preferred language in user profile on first detection
    - Apply preferred language to all subsequent WhatsApp UI labels, messages, and confirmations
    - _Requirements: 10.2, 10.4_

  - [x] 11.3 Implement low-confidence translation fallback and operator flagging
    - When confidence is below threshold, apply multilingual fallback and flag message for operator review
    - _Requirements: 10.8, 10.9_

  - [x] 11.4 Write property test for translation round-trip and storage (Property 20)
    - **Property 20: Translation Round-Trip and Storage**
    - **Validates: Requirements 10.3, 10.7, 16.5**

  - [x] 11.5 Write property test for user language preference persistence (Property 21)
    - **Property 21: User Language Preference Persistence**
    - **Validates: Requirements 10.2, 10.4**

  - [x] 11.6 Write property test for low-confidence translation fallback (Property 22)
    - **Property 22: Low-Confidence Translation Fallback**
    - **Validates: Requirements 10.8**

- [x] 12. WhatsApp Renderer
  - [x] 12.1 Implement `WhatsAppRenderer` service
    - `renderMessage(content, userLanguage)`: produce WhatsApp-safe message payload
    - Validate against WhatsApp UI limits (button counts ≤ 3, list items ≤ 10, text lengths) before delivery
    - Fall back to plain text when a UI type is unsupported
    - Translate all labels, prompts, and confirmations to user's preferred language
    - _Requirements: 15.1, 15.2, 15.5, 15.6, 4.6_

  - [x] 12.2 Implement confirmation message renderer
    - Before booking/payment execution, render confirmation summarising selection, price, currency, date, time, location with confirm/cancel options
    - _Requirements: 15.4_

  - [x] 12.3 Implement missing-field prompt renderer
    - Render missing field prompts in user's language with one-tap options where possible
    - _Requirements: 15.3_

  - [x] 12.4 Write property test for WhatsApp UI limit compliance (Property 15)
    - **Property 15: WhatsApp UI Limit Compliance**
    - **Validates: Requirements 7.7, 15.1, 15.2**

- [x] 13. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Orchestrator — core decision and state transition loop
  - [x] 14.1 Implement `Orchestrator` service — main per-turn processing pipeline
    - Load context package from SessionManager
    - Call LLMService in decision mode
    - Validate LLM output
    - Determine next action: UI narrowing, schema field collection, or tool execution
    - Enforce business rules and permissions
    - Maintain state transitions in State_Store and Durable_Store
    - _Requirements: 2.1, 2.2, 2.3, 4.4, 4.5_

  - [x] 14.2 Implement intent narrowing flow
    - When confidence is low or intent is ambiguous, generate top-level intent narrowing UI (Explore, Book Now, Compare)
    - _Requirements: 2.1, 2.2_

  - [x] 14.3 Implement human handoff trigger logic
    - Detect handoff conditions (repeated LLM failure, repeated tool failure, payment issue, vendor exception, unsupported request)
    - Create `HumanHandoff` record with session summary, user language, schema state, tool results, pending actions
    - Notify user that a human operator is taking over
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 14.4 Write unit tests for Orchestrator state transition logic
    - Test each decision branch: narrowing, schema collection, tool execution, handoff
    - _Requirements: 2.1, 2.3, 4.4, 13.1_

- [x] 15. Hotel Search vertical — schema, tool, and result rendering
  - [x] 15.1 Define and seed `search_hotels` schema (v1.0) in the schema registry
    - Required fields: `location`, `checkin_date`; optional: `checkout_date`, `guests`, `budget`, `currency`
    - Include UI metadata, validation rules, localization label keys, and fallback prompts
    - _Requirements: 3.1, 3.2, 7.1, 7.2_

  - [x] 15.2 Implement `HotelSearchAdapter` (ProviderAdapter)
    - Execute hotel search against configured provider via NangoAdapter
    - Normalise raw provider response into internal `HotelResult` schema (name, price, currency, rating, review count, location, distance, amenities, cancellation policy, booking token)
    - Return structured failure state on provider exhaustion
    - _Requirements: 7.3, 7.4_

  - [x] 15.3 Implement hotel result rendering in WhatsAppRenderer
    - Format hotel cards with name, price, currency, rating, review count, location, distance, amenities, cancellation policy
    - Include Book Now and More Info action buttons per result
    - Handle no-results case with alternative search options
    - _Requirements: 7.5, 7.6, 7.7, 7.8_

  - [x] 15.4 Write property test for hotel result normalisation and rendering (Property 14)
    - **Property 14: Hotel Result Normalisation and Rendering**
    - **Validates: Requirements 7.4, 7.5, 7.6**

- [x] 16. Booking Manager
  - [x] 16.1 Implement `BookingManager` service
    - `initiateBooking(sessionId, hotelResult)`: create booking record in Durable_Store with state `initiated`
    - `requestHold(bookingId)`: transition to `hold_requested` → `hold_confirmed` if provider supports holds
    - `initiatePayment(bookingId)`: transition to `payment_pending`
    - `confirmBooking(bookingId)`: transition to `confirmed` after provider confirmation + payment success
    - `cancelBooking(bookingId)`: transition to `cancelled` with provider notification
    - `handleTimeout(bookingId)`: transition to `timed_out`, cancel hold
    - Enforce state machine — reject invalid transitions
    - Record every state transition as a `BookingEvent` in Durable_Store
    - Enforce idempotency on all booking actions
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 16.2 Write property test for booking state machine validity (Property 16)
    - **Property 16: Booking State Machine Validity**
    - **Validates: Requirements 8.2, 8.3**

  - [x] 16.3 Write property test for booking audit trail completeness (Property 17)
    - **Property 17: Booking Audit Trail Completeness**
    - **Validates: Requirements 8.7**

  - [x] 16.4 Write property test for booking and payment idempotency (Property 18)
    - **Property 18: Booking and Payment Idempotency**
    - **Validates: Requirements 8.8, 9.6, 9.7, 21.1, 21.2**

- [x] 17. Payment Manager
  - [x] 17.1 Implement `PaymentManager` service
    - `initiatePayment(bookingId, method)`: create payment record, transition to `initiated` → `pending`
    - Support telco billing and payment link generation
    - `handleWebhookCallback(event)`: validate callback, deduplicate on event ID, update payment state
    - Transition states: `initiated → pending → succeeded/failed/timed_out`, `succeeded → refunded_or_cancelled`
    - Enforce state machine — reject invalid transitions
    - Enforce idempotency on payment initiation and webhook processing
    - Do not log sensitive payment references in unprotected form
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 18.4_

  - [x] 17.2 Write property test for payment state machine validity (Property 19)
    - **Property 19: Payment State Machine Validity**
    - **Validates: Requirements 9.4, 9.5, 9.8**

- [x] 18. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. TTS Service
  - [x] 19.1 Implement `TTSService`
    - `generateAudio(validatedText, language, userPrefs)`: generate audio from final validated response text only (never raw LLM output)
    - Support configurable voice selection per language
    - Deliver as WhatsApp voice note, media link, or audio attachment
    - Cache generated assets; return cached asset for identical text
    - Non-blocking: TTS generation must not delay booking/payment flow completion
    - Fall back to text delivery on TTS failure; log failure with Correlation_ID
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [x] 19.2 Write property test for TTS source integrity (Property 23)
    - **Property 23: TTS Source Integrity**
    - **Validates: Requirements 11.7**

  - [x] 19.3 Write property test for TTS failure fallback (Property 24)
    - **Property 24: TTS Failure Fallback**
    - **Validates: Requirements 11.6, 11.5**

  - [x] 19.4 Write property test for TTS caching idempotency (Property 25)
    - **Property 25: TTS Caching Idempotency**
    - **Validates: Requirements 11.8**

- [x] 20. Observability — Correlation ID propagation and audit logging
  - [x] 20.1 Implement `AuditLogger` service
    - `log(event)`: write audit log entry with request ID, session ID, user ID/phone hash, action type, model used, tool used, provider used, execution status, latency, error codes, timestamp
    - Propagate Correlation_ID through all downstream log entries (tool calls, provider calls, audit entries, error logs)
    - _Requirements: 17.1, 17.4, 16.6_

  - [x] 20.2 Implement error classification
    - Classify every system error into exactly one category: user input error, schema error, provider failure, payment failure, translation failure, internal system error
    - _Requirements: 17.5_

  - [x] 20.3 Wire Correlation_ID propagation through all services
    - Ensure AI_Gateway-assigned Correlation_ID appears in every downstream log entry
    - _Requirements: 17.1_

  - [x] 20.4 Write property test for Correlation ID propagation (Property 26)
    - **Property 26: Correlation ID Propagation**
    - **Validates: Requirements 17.1**

  - [x] 20.5 Write property test for audit log completeness (Property 27)
    - **Property 27: Audit Log Completeness**
    - **Validates: Requirements 16.6, 17.4**

  - [x] 20.6 Write property test for error classification (Property 28)
    - **Property 28: Error Classification**
    - **Validates: Requirements 17.5**

- [x] 21. Vendor CMS — WhatsApp-based vendor interface
  - [x] 21.1 Implement `VendorCMS` service
    - Vendor registration and WhatsApp number association
    - Vendor account verification and approval flow
    - Deliver booking requests to vendor WhatsApp in vendor's preferred language using structured templates
    - Handle vendor responses: Accept, Decline, Suggest alternative, Mark unavailable, Request clarification
    - Validate all vendor-originated actions against vendor's authorized account before processing
    - Log all vendor actions in audit trail with Correlation_IDs
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.11, 20.12_

  - [x] 21.2 Implement vendor availability and quota management
    - Allow vendors to update capacity, slots, blackout periods, and service availability via WhatsApp flows
    - Sync updates into platform routing state in near real time
    - _Requirements: 20.5, 20.6_

  - [x] 21.3 Implement vendor notification and fulfillment flows
    - Notify vendors on new booking, cancellation, modification, or customer update
    - Allow vendors to confirm fulfillment, mark arrival, mark completed, report exceptions
    - Support vendor escalation to human support
    - Fall back to manual operations or admin override on vendor flow failure
    - _Requirements: 20.7, 20.8, 20.9, 20.10, 20.13_

  - [x] 21.4 Write property test for vendor action authorization (Property 29)
    - **Property 29: Vendor Action Authorization**
    - **Validates: Requirements 20.11, 20.12**

  - [x] 21.5 Write property test for vendor availability sync (Property 30)
    - **Property 30: Vendor Availability Sync**
    - **Validates: Requirements 20.6**

- [x] 22. Proactive and follow-up messaging
  - [x] 22.1 Implement `ProactiveMessagingService`
    - Schedule optional proactive jobs (reminders, check-in alerts, weather/traffic updates) after booking confirmation
    - All jobs configurable and disabled by default
    - Respect user consent and platform policy; do not send if disallowed
    - Link all scheduled jobs to originating booking and session records
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 23. Master Admin Interface — backend API
  - [x] 23.1 Implement admin REST API endpoints
    - System configuration management (orchestration, schemas, routing, retries, fallbacks, feature flags)
    - Vertical and schema management (add/edit/enable/disable verticals, schemas, UI prompts, validation rules)
    - Vendor and partner management (add/edit/suspend/reactivate/remove vendors)
    - API and integration management (MCP tool mappings, routing rules, normalization, failover)
    - Live session and workflow management (view/retry/cancel/override sessions, bookings, payments, escalations)
    - WhatsApp template and multilingual content management (update without code deployment)
    - Configuration change rollback support
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.8, 19.9_

  - [x] 23.2 Implement RBAC middleware for Admin Interface
    - Enforce role-based access control: super admin, operations admin, vendor admin, finance admin, support admin, analyst
    - Log all admin actions with acting user, timestamp, old value, new value
    - _Requirements: 18.6, 18.7, 19.10_

  - [x] 23.3 Implement admin reporting and dashboard data endpoints
    - Expose queryable data for bookings, revenue, vendor performance, conversion funnels, user engagement, API performance, language usage, latency, errors, payment completion, operational KPIs
    - _Requirements: 19.7_

- [x] 24. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 25. Integration wiring — connect all components into the main request pipeline
  - [x] 25.1 Wire the full per-turn request pipeline
    - AI_Gateway → SessionManager → Orchestrator → LLMService → SchemaEngine → MCPInterface → ProviderAdapters → WhatsAppRenderer → Twilio outbound delivery
    - Ensure Correlation_ID flows through every step
    - Ensure AuditLogger is called at every critical event
    - _Requirements: 1.1–1.8, 2.1–2.7, 4.1–4.6, 5.1–5.7, 17.1–17.6_

  - [x] 25.2 Wire hotel search and booking end-to-end flow
    - Connect hotel search schema → HotelSearchAdapter → result rendering → BookingManager → PaymentManager → confirmation message
    - _Requirements: 7.1–7.8, 8.1–8.8, 9.1–9.8_

  - [x] 25.3 Wire translation and TTS into the rendering pipeline
    - TranslationService applied to inbound messages and outbound labels
    - TTSService invoked non-blocking after final response is validated
    - _Requirements: 10.1–10.9, 11.1–11.8_

  - [x] 25.4 Write integration tests for the full hotel search and booking flow
    - Test text-first flow, button-first flow, missing schema collection, booking initiation, payment initiation, confirmation
    - _Requirements: 7.1–7.8, 8.1–8.8, 9.1–9.8_

  - [x] 25.5 Write integration tests for duplicate webhook and idempotency handling
    - Test duplicate inbound webhook, duplicate payment callback, duplicate booking initiation
    - _Requirements: 21.1, 21.2_

- [x] 26. CI/CD and environment configuration
  - [x] 26.1 Set up CI pipeline (GitHub Actions or equivalent)
    - Run TypeScript type-check, lint, and test suite on every pull request
    - _Requirements: 23.4_

  - [x] 26.2 Implement database migration runner
    - Safe migration apply/rollback strategy across local, staging, and production environments
    - _Requirements: 23.5_

  - [x] 26.3 Implement secrets injection from secure secrets store
    - Load all credentials from secrets manager at startup; no secrets in code or unprotected config files
    - _Requirements: 18.2, 23.3_

- [x] 27. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests (Properties 1–30) validate universal correctness guarantees from the design document
- Unit and integration tests validate specific examples and edge cases
- The implementation language is TypeScript (Node.js) throughout
