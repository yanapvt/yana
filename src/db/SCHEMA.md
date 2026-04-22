# Database Schema Overview

## Core Entities

### User Management
- **users** - Core user identity (user_id, phone_number, phone_hash)
- **user_profiles** - Static profile data (name, nationality, preferred_language, home_location, preferred_currency)
- **user_preferences** - Communication preferences (tts_enabled, proactive_messaging_enabled, notification_preferences)
- **user_language_settings** - Behavioral memory (recent_actions, frequent_services, common_destinations, preferred_vendors, past_bookings, timing_patterns)

### Session Management
- **sessions** - Session lifecycle (session_id, user_id, phone_number, timestamps)
- **session_state** - Live session state (current_intent, current_step, active_schema, schema_version, missing_fields, collected_fields, pending_options, booking_progress, payment_progress, conversation_history)

### Messaging
- **messages** - Conversation history (message_id, session_id, user_id, correlation_id, message_type, role, content)
- **message_translations** - Multilingual support (translation_id, message_id, original_text, detected_language, translated_text, canonical_form, translation_confidence, translator_metadata)

### Schema System
- **schemas** - Schema registry (schema_id, schema_name, current_version)
- **schema_versions** - Versioned schema definitions (version_id, schema_id, version, required_fields, optional_fields, fields, metadata, is_active)

### Tool System
- **tool_registry** - MCP tool definitions (tool_id, tool_name, tool_version, contract, execution_policy, is_enabled)
- **tool_runs** - Tool execution logs (run_id, correlation_id, session_id, user_id, tool_name, input_params, output_data, error_data, execution_status, execution_time_ms, attempt_number, provider_name)

### Provider Integration
- **provider_integrations** - External service providers (provider_id, provider_name, provider_type, integration_type, config, credentials_ref, is_enabled, retry_policy, rate_limit_config)

### Booking System
- **bookings** - Booking lifecycle (booking_id, user_id, session_id, correlation_id, state, service_type, service_details, provider_name, provider_booking_ref, amount, currency, timestamps)
- **booking_events** - Booking state transition audit trail (event_id, booking_id, previous_state, new_state, triggering_action, metadata)

### Payment System
- **payments** - Payment lifecycle (payment_id, booking_id, user_id, correlation_id, state, amount, currency, payment_method, provider_name, provider_payment_ref, payment_url, timestamps)
- **payment_events** - Payment state transition audit trail (event_id, payment_id, previous_state, new_state, triggering_action, metadata)

### Vendor Management
- **vendors** - External service providers (vendor_id, vendor_name, vendor_type, whatsapp_numbers, is_verified, is_active, coverage_areas, operating_hours, sla_config, scoring_data)
- **vendor_preferences** - Vendor communication preferences (vendor_id, preferred_language, notification_preferences, availability_settings, pricing_settings)
- **vendor_language_settings** - Vendor multilingual support (vendor_id, supported_languages, default_language, translation_preferences)

### Operations
- **human_handoffs** - Escalation to human operators (handoff_id, session_id, user_id, correlation_id, triggering_condition, operator_id, session_summary, status, timestamps)
- **notifications** - Proactive and follow-up messaging (notification_id, user_id, booking_id, session_id, notification_type, scheduled_at, sent_at, status, content, metadata)

### Observability
- **audit_logs** - Comprehensive system audit trail (log_id, correlation_id, session_id, user_id, phone_hash, action_type, model_used, tool_used, provider_used, execution_status, latency_ms, error_code, error_category, metadata)
- **decision_logs** - LLM decision outputs (decision_id, correlation_id, session_id, user_id, intent, parameters, missing_fields, suggested_action, confidence, reasoning, model_used)

### Media
- **tts_assets** - Text-to-speech generated audio (asset_id, text_hash, original_text, language, audio_url, audio_format, duration_ms, provider_name, metadata, timestamps)

## State Machines

### Booking States
- initiated → hold_requested → hold_confirmed → payment_pending → confirmed
- initiated → payment_pending → confirmed
- any_state → cancelled
- any_state → timed_out

### Payment States
- initiated → pending → succeeded
- initiated → pending → failed
- initiated → pending → timed_out
- succeeded → refunded_or_cancelled

## Key Relationships

```
users (1) ─── (1) user_profiles
      (1) ─── (1) user_preferences
      (1) ─── (1) user_language_settings
      (1) ─── (N) sessions
      (1) ─── (N) messages
      (1) ─── (N) bookings
      (1) ─── (N) payments

sessions (1) ─── (1) session_state
         (1) ─── (N) messages
         (1) ─── (N) bookings
         (1) ─── (N) tool_runs

bookings (1) ─── (N) booking_events
         (1) ─── (N) payments
         (1) ─── (N) notifications

payments (1) ─── (N) payment_events

vendors (1) ─── (1) vendor_preferences
        (1) ─── (1) vendor_language_settings

messages (1) ─── (N) message_translations

schemas (1) ─── (N) schema_versions
```

## Index Strategy

### Performance Indexes
- User lookup: phone_number, phone_hash
- Session lookup: user_id, phone_number, last_activity_at
- Message lookup: session_id, user_id, created_at
- Booking queries: user_id, session_id, state, provider_name, created_at
- Payment queries: booking_id, user_id, state, provider_name, created_at
- Tool runs: tool_name, execution_status, created_at

### Traceability Indexes (Correlation_ID)
- messages.correlation_id
- tool_runs.correlation_id
- bookings.correlation_id
- payments.correlation_id
- audit_logs.correlation_id
- decision_logs.correlation_id
- human_handoffs.correlation_id

### Operational Indexes
- Schema versions: schema_id, is_active
- Tool registry: tool_name, is_enabled
- Provider integrations: provider_name, provider_type, is_enabled
- Vendors: vendor_type, is_verified, is_active
- Human handoffs: status, operator_id, created_at
- Notifications: scheduled_at, status, notification_type
- Audit logs: action_type, execution_status, error_category, created_at
- TTS assets: text_hash, language, last_accessed_at

## Data Types

### JSONB Fields
Used for flexible, schema-less data that may evolve:
- User behavioral memory (recent_actions, frequent_services, etc.)
- Session state (collected_fields, pending_options, conversation_history)
- Message content and metadata
- Schema field definitions
- Tool contracts and execution policies
- Service details and provider configs
- Booking and payment metadata
- Vendor configurations
- Notification content

### UUID Primary Keys
All tables use UUID primary keys for:
- Global uniqueness across distributed systems
- Security (non-sequential, non-guessable)
- Easy replication and sharding

### Timestamps
All tables include:
- created_at (TIMESTAMPTZ) - Record creation time
- updated_at (TIMESTAMPTZ) - Last modification time (where applicable)
- Additional state-specific timestamps (confirmed_at, cancelled_at, etc.)

## Requirements Satisfied

- **16.2** - Durable storage of all core entities
- **16.4** - Three-layer user context (static profile, behavioral memory, live session state)
- **16.5** - Translation record storage with confidence and metadata
- **16.6** - Comprehensive audit logging with correlation IDs
- **23.5** - Versioned migration strategy for safe schema evolution
