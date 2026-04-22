# Task 2.2 Completion: Typed Data-Access Repository Classes

## Overview

Implemented typed data-access repository classes for all entity groups in the YANA / OGO platform. All repositories follow idempotent design principles to satisfy Requirements 16.2 and 21.2.

## Implemented Repositories

### 1. UserRepository
**Location:** `src/db/repositories/UserRepository.ts`

**Entities Managed:**
- `users` - Core user identity
- `user_profiles` - Static profile data
- `user_preferences` - Communication preferences
- `user_language_settings` - Behavioral memory

**Key Methods:**
- `createUser()` - Idempotent user creation with all related entities
- `findByPhoneNumber()` - Lookup by phone number
- `findById()` - Lookup by user ID
- `getProfile()` / `updateProfile()` - Profile management
- `getPreferences()` / `updatePreferences()` - Preferences management
- `getLanguageSettings()` / `updateLanguageSettings()` - Behavioral memory management

**Idempotency:** Uses phone_number uniqueness to prevent duplicate user creation.

---

### 2. SessionRepository
**Location:** `src/db/repositories/SessionRepository.ts`

**Entities Managed:**
- `sessions` - Session lifecycle
- `session_state` - Live session state

**Key Methods:**
- `createSession()` - Idempotent session creation with initial state
- `findById()` - Lookup by session ID
- `findActiveByUserId()` - Find active session for user
- `updateLastActivity()` - Update session activity timestamp
- `getState()` / `updateState()` - Session state management
- `appendConversationHistory()` - Add messages to conversation history

**Idempotency:** Reuses active sessions within 1-hour window; updates last activity instead of creating duplicates.

---

### 3. MessageRepository
**Location:** `src/db/repositories/MessageRepository.ts`

**Entities Managed:**
- `messages` - Conversation history
- `message_translations` - Multilingual support

**Key Methods:**
- `createMessage()` - Idempotent message creation
- `findById()` - Lookup by message ID
- `findBySessionId()` - Get session messages
- `findByCorrelationId()` - Trace messages by correlation ID
- `createTranslation()` - Idempotent translation creation
- `findTranslationByMessageId()` - Get message translation

**Idempotency:** Uses correlation_id + session_id to prevent duplicate messages; one translation per message.

---

### 4. SchemaRepository
**Location:** `src/db/repositories/SchemaRepository.ts`

**Entities Managed:**
- `schemas` - Schema registry
- `schema_versions` - Versioned schema definitions

**Key Methods:**
- `createSchema()` - Idempotent schema creation
- `findByName()` / `findById()` - Schema lookup
- `updateCurrentVersion()` - Update active version
- `createVersion()` - Idempotent version creation
- `findVersion()` - Get specific version
- `findVersionsBySchemaId()` - Get all versions
- `findActiveVersions()` - Get active versions only
- `deactivateVersion()` - Deactivate a version

**Idempotency:** Uses schema_name uniqueness; schema_id + version uniqueness for versions.

---

### 5. ToolRepository
**Location:** `src/db/repositories/ToolRepository.ts`

**Entities Managed:**
- `tool_registry` - MCP tool definitions
- `tool_runs` - Tool execution logs

**Key Methods:**
- `registerTool()` - Idempotent tool registration (updates if exists)
- `findByName()` - Lookup by tool name
- `findEnabled()` - Get all enabled tools
- `setEnabled()` - Enable/disable tool
- `createRun()` - Idempotent tool run creation
- `findRunsByCorrelationId()` - Trace tool runs
- `findRunsBySessionId()` - Get session tool runs
- `findRunsByToolName()` - Get tool execution history

**Idempotency:** Updates existing tools on re-registration; uses correlation_id + tool_name + attempt_number for runs.

---

### 6. BookingRepository
**Location:** `src/db/repositories/BookingRepository.ts`

**Entities Managed:**
- `bookings` - Booking lifecycle
- `booking_events` - State transition audit trail

**Key Methods:**
- `createBooking()` - Idempotent booking creation with initial event
- `findById()` / `findByCorrelationId()` - Booking lookup
- `findByUserId()` / `findBySessionId()` - User/session bookings
- `updateState()` - State transition with event tracking
- `updateProviderBookingRef()` - Update provider reference
- `getEvents()` - Get booking event history

**Idempotency:** Uses correlation_id to prevent duplicate bookings; state transitions create audit events.

---

### 7. PaymentRepository
**Location:** `src/db/repositories/PaymentRepository.ts`

**Entities Managed:**
- `payments` - Payment lifecycle
- `payment_events` - State transition audit trail

**Key Methods:**
- `createPayment()` - Idempotent payment creation with initial event
- `findById()` / `findByCorrelationId()` - Payment lookup
- `findByBookingId()` / `findByUserId()` - Related payments
- `updateState()` - State transition with event tracking
- `updateProviderPaymentRef()` - Update provider reference
- `updatePaymentUrl()` - Update payment URL
- `getEvents()` - Get payment event history

**Idempotency:** Uses correlation_id to prevent duplicate payments; state transitions create audit events.

---

### 8. AuditRepository
**Location:** `src/db/repositories/AuditRepository.ts`

**Entities Managed:**
- `audit_logs` - Comprehensive system audit trail
- `decision_logs` - LLM decision outputs

**Key Methods:**
- `createAuditLog()` - Create audit log entry
- `findByCorrelationId()` - Trace audit logs
- `findBySessionId()` / `findByUserId()` - User/session audit logs
- `findByActionType()` - Filter by action type
- `findByErrorCategory()` - Filter by error category
- `createDecisionLog()` - Idempotent decision log creation
- `findDecisionByCorrelationId()` - Get decision log
- `findDecisionsBySessionId()` / `findDecisionsByUserId()` - User/session decisions

**Idempotency:** Decision logs use correlation_id uniqueness; audit logs allow multiple entries per correlation_id.

---

## Database Connection

**Location:** `src/db/connection.ts`

**Features:**
- Connection pooling with configurable limits
- Health check function
- Graceful shutdown support
- Environment-based configuration

---

## Design Principles

### 1. Idempotency (Requirement 21.2)
All write operations are designed to be idempotent where applicable:
- **Create operations:** Check for existing records using unique identifiers (correlation_id, phone_number, etc.)
- **Update operations:** Can be called multiple times with same values safely
- **State transitions:** Record events but allow duplicate transitions

### 2. Type Safety
- All repositories use TypeScript interfaces for type safety
- Database column names mapped to camelCase TypeScript properties
- JSONB fields properly typed as Record<string, unknown> or specific types

### 3. Transaction Support
- Critical operations (user creation, booking/payment creation) use transactions
- Ensures atomicity of multi-table operations
- Proper rollback on errors

### 4. Correlation ID Traceability
- All major entities support correlation_id for end-to-end tracing
- Enables complete request flow tracking across all repositories

### 5. Audit Trail
- Booking and payment state changes automatically create event records
- Complete history of state transitions preserved
- Metadata support for additional context

---

## Dependencies Added

```json
{
  "dependencies": {
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0"
  }
}
```

---

## Usage Example

```typescript
import { UserRepository, SessionRepository, MessageRepository } from './db/repositories/index.js';

// Create repository instances
const userRepo = new UserRepository();
const sessionRepo = new SessionRepository();
const messageRepo = new MessageRepository();

// Create user (idempotent)
const user = await userRepo.createUser(
  '+1234567890',
  'hash123',
  'en',
  'USD'
);

// Create session (idempotent - reuses active session)
const session = await sessionRepo.createSession(user.userId, user.phoneNumber);

// Create message (idempotent via correlation_id)
const message = await messageRepo.createMessage({
  sessionId: session.sessionId,
  userId: user.userId,
  correlationId: 'corr-123',
  fromNumber: '+1234567890',
  toNumber: '+0987654321',
  messageType: 'text',
  role: 'user',
  content: { body: 'Hello' }
});
```

---

## Requirements Satisfied

✅ **Requirement 16.2** - Durable storage of all core entities
- All 8 repository classes implemented
- Complete CRUD operations for all entity groups
- Proper data persistence to Postgres

✅ **Requirement 21.2** - Idempotency for all writes where applicable
- User creation idempotent via phone_number
- Session creation reuses active sessions
- Message creation idempotent via correlation_id
- Booking/payment creation idempotent via correlation_id
- Tool registration updates existing tools
- Schema/version creation idempotent via unique constraints
- State updates can be called multiple times safely

---

## Next Steps

To use these repositories:
1. Run `npm install` to install pg and @types/pg
2. Ensure database migrations are applied (Task 2.1)
3. Configure environment variables for Postgres connection
4. Import and instantiate repositories as needed
5. Use repositories in service layer for data access

---

## Files Created

1. `src/db/connection.ts` - Database connection pool
2. `src/db/repositories/UserRepository.ts` - User entity management
3. `src/db/repositories/SessionRepository.ts` - Session entity management
4. `src/db/repositories/MessageRepository.ts` - Message entity management
5. `src/db/repositories/SchemaRepository.ts` - Schema entity management
6. `src/db/repositories/ToolRepository.ts` - Tool entity management
7. `src/db/repositories/BookingRepository.ts` - Booking entity management
8. `src/db/repositories/PaymentRepository.ts` - Payment entity management
9. `src/db/repositories/AuditRepository.ts` - Audit entity management
10. `src/db/repositories/index.ts` - Repository exports

---

## Testing Recommendations

1. **Unit Tests:** Test each repository method with mock database
2. **Integration Tests:** Test against real Postgres database
3. **Idempotency Tests:** Verify duplicate operations produce same results
4. **Transaction Tests:** Verify rollback behavior on errors
5. **Correlation ID Tests:** Verify traceability across repositories
