# Database Migrations

This directory contains PostgreSQL migration files for the YANA / OGO Platform.

## Migration Files

Migrations are numbered sequentially and should be applied in order:

1. **001_create_users_and_profiles.sql** - Users, profiles, preferences, and language settings
2. **002_create_sessions.sql** - Sessions and session state
3. **003_create_messages.sql** - Messages and message translations
4. **004_create_schemas.sql** - Schema registry and versions
5. **005_create_tools.sql** - Tool registry and tool runs
6. **006_create_provider_integrations.sql** - Provider integrations
7. **007_create_bookings.sql** - Bookings and booking events
8. **008_create_payments.sql** - Payments and payment events
9. **009_create_vendors.sql** - Vendors, preferences, and language settings
10. **010_create_human_handoffs.sql** - Human handoff escalations
11. **011_create_notifications.sql** - Proactive notifications
12. **012_create_audit_logs.sql** - Audit logs and decision logs
13. **013_create_tts_assets.sql** - Text-to-speech assets

## Key Indexes

### Session Lookup
- `idx_sessions_user_id` - Fast session lookup by user
- `idx_sessions_phone_number` - Fast session lookup by phone
- `idx_sessions_last_activity` - Query active sessions

### User Lookup
- `idx_users_phone_number` - Fast user lookup by phone
- `idx_users_phone_hash` - Privacy-preserving user lookup

### Booking/Payment State Queries
- `idx_bookings_state` - Query bookings by state
- `idx_bookings_user_id` - User's booking history
- `idx_payments_state` - Query payments by state
- `idx_payments_booking_id` - Payment lookup by booking

### Correlation_ID Queries
- `idx_messages_correlation_id` - Trace messages by correlation ID
- `idx_tool_runs_correlation_id` - Trace tool runs by correlation ID
- `idx_bookings_correlation_id` - Trace bookings by correlation ID
- `idx_payments_correlation_id` - Trace payments by correlation ID
- `idx_audit_logs_correlation_id` - Trace audit logs by correlation ID
- `idx_decision_logs_correlation_id` - Trace decisions by correlation ID
- `idx_human_handoffs_correlation_id` - Trace handoffs by correlation ID

## Requirements Validation

These migrations satisfy the following requirements:

- **16.2** - Durable storage of users, sessions, messages, bookings, payments, etc.
- **16.4** - User context storage (static profile, behavioral memory, live session state)
- **16.5** - Translation record storage
- **16.6** - Audit log storage with comprehensive event tracking
- **23.5** - Database migration strategy for safe schema changes

## Running Migrations

Migrations can be applied using a PostgreSQL client or migration tool:

```bash
# Using psql
psql -U username -d database_name -f src/db/migrations/001_create_users_and_profiles.sql

# Or apply all migrations in order
for file in src/db/migrations/*.sql; do
  psql -U username -d database_name -f "$file"
done
```

## Migration Strategy

- Migrations are idempotent where possible (use `IF NOT EXISTS` clauses)
- Each migration is atomic (wrapped in a transaction)
- Migrations can be applied safely across local, staging, and production environments
- Schema changes are versioned and tracked
- Rollback scripts should be created for destructive changes
