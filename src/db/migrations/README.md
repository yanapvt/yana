# Database Migrations

13 SQL migration files applied in order. Each is idempotent where possible (`IF NOT EXISTS`).

## Running Migrations

```bash
npm run migrate
```

This uses `src/db/migrate.ts` which:
1. Connects to Postgres using credentials from `.env`
2. Creates a `schema_migrations` table if it doesn't exist
3. Applies each `.sql` file in a transaction
4. Records applied migrations so they're never run twice
5. Skips already-applied migrations on subsequent runs

Expected output:
```
Found 13 migration files.
  APPLY 001_create_users_and_profiles.sql
  APPLY 002_create_sessions.sql
  ...
Done. Applied: 13, Skipped: 0
```

On subsequent runs:
```
Found 13 migration files.
  SKIP  001_create_users_and_profiles.sql
  ...
Done. Applied: 0, Skipped: 13
```

## Migration Files

| File | Tables Created |
|---|---|
| `001_create_users_and_profiles.sql` | `users`, `user_profiles`, `user_preferences`, `user_language_settings` |
| `002_create_sessions.sql` | `sessions`, `session_state` |
| `003_create_messages.sql` | `messages`, `message_translations` |
| `004_create_schemas.sql` | `schemas`, `schema_versions` |
| `005_create_tools.sql` | `tool_registry`, `tool_runs` |
| `006_create_provider_integrations.sql` | `provider_integrations` |
| `007_create_bookings.sql` | `bookings`, `booking_events` |
| `008_create_payments.sql` | `payments`, `payment_events` |
| `009_create_vendors.sql` | `vendors`, `vendor_preferences`, `vendor_language_settings` |
| `010_create_human_handoffs.sql` | `human_handoffs` |
| `011_create_notifications.sql` | `notifications` |
| `012_create_audit_logs.sql` | `audit_logs`, `decision_logs` |
| `013_create_tts_assets.sql` | `tts_assets` |

## Notes

- `phone_number` columns are `VARCHAR(30)` to accommodate the `whatsapp:+XXXXXXXXXXX` format used by Twilio
- All primary keys are UUIDs
- All tables have `created_at TIMESTAMPTZ`
- JSONB is used for flexible fields (session state, message content, tool contracts, etc.)
