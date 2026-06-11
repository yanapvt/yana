# Repository Unit Tests

## Overview

This directory contains unit tests for all repository classes that test create, read, update, and upsert operations against a test database.

**Requirements Validated:** 16.2 (Durable storage of all core entities)

## Test Coverage

The test suite covers the following repositories:

1. **UserRepository** - Users, profiles, preferences, and language settings
2. **SessionRepository** - Sessions and session state
3. **MessageRepository** - Messages and translations
4. **BookingRepository** - Bookings and booking events
5. **PaymentRepository** - Payments and payment events
6. **SchemaRepository** - Schemas and schema versions
7. **ToolRepository** - Tool registry and tool runs
8. **AuditRepository** - Audit logs and decision logs

## Prerequisites

### Database Setup

The tests require a PostgreSQL database with all migrations applied. Before running the tests:

1. **Set up environment variables** (create a `.env` file or export):
   ```bash
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_DB=yana_ogo_test  # Use a separate test database
   POSTGRES_USER=your_user
   POSTGRES_PASSWORD=your_password
   ```

2. **Create the test database**:
   ```bash
   createdb yana_ogo_test
   ```

3. **Run migrations**:
   ```bash
   npm run migrate  # Or your migration command
   ```

## Running the Tests

Run all repository tests:
```bash
npm test -- src/db/repositories/repositories.test.ts
```

Run with watch mode:
```bash
npm run test:watch -- src/db/repositories/repositories.test.ts
```

## Test Structure

Each repository test suite follows this pattern:

### 1. Create Operations
- Tests basic entity creation
- Verifies all fields are properly stored
- Tests idempotency (duplicate prevention)

### 2. Read Operations
- Tests finding entities by ID
- Tests finding entities by various criteria
- Tests returning null for non-existent entities

### 3. Update Operations
- Tests updating entity fields
- Verifies partial updates work correctly
- Tests idempotency of updates

### 4. Upsert Operations
- Tests insert-or-update behavior
- Verifies existing records are not duplicated

## Key Testing Principles

### Idempotency
All repository methods that create or update data are tested for idempotency:
- Creating the same entity twice returns the existing entity
- Updates can be called multiple times safely
- Correlation IDs prevent duplicate bookings/payments/messages

### Data Integrity
Tests verify:
- Foreign key relationships are maintained
- Transactions rollback on errors
- Related entities are created atomically (e.g., user + profile + preferences)

### Type Safety
All tests use TypeScript types to ensure:
- Correct field types are returned
- Enums are properly validated
- Optional fields are handled correctly

## Test Data Cleanup

The test suite automatically cleans up all test data:
- **Before each test**: Database is cleaned to ensure test isolation
- **After all tests**: Final cleanup and connection pool closure

Cleanup order respects foreign key dependencies:
```
payment_events → payments
booking_events → bookings
tool_runs → tool_registry
decision_logs, audit_logs
message_translations → messages
session_state → sessions
schema_versions → schemas
user_* → users
```

## Common Issues

### Connection Errors
If tests fail with connection errors:
1. Verify PostgreSQL is running
2. Check environment variables are set correctly
3. Ensure the test database exists
4. Verify migrations have been applied

### Foreign Key Violations
If tests fail with foreign key errors:
1. Check that cleanup order is correct
2. Verify migrations created all required tables
3. Ensure test data is created in the correct order

### Timeout Errors
If tests timeout:
1. Check database performance
2. Verify indexes are created by migrations
3. Consider increasing test timeout in vitest config

## Future Enhancements

Potential improvements for the test suite:

1. **Test Database Isolation**: Use a separate test database or schema
2. **Transaction Rollback**: Wrap each test in a transaction and rollback
3. **Test Fixtures**: Create reusable test data factories
4. **Performance Tests**: Add tests for query performance with large datasets
5. **Concurrent Access**: Test repository behavior under concurrent access

## Related Documentation

- [Database Schema](../SCHEMA.md)
- [Migration Guide](../migrations/README.md)
- [Task 2.2 Completion](../TASK_2.2_COMPLETION.md)
