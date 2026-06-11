# Services

This directory contains service layer implementations for the YANA / OGO platform.

## StateStore Service

The `StateStore` service wraps Redis to provide hot session state management with TTL-based expiry.

### Purpose

- Maintains active session state for fast access during user interactions
- Provides short-lived tool result caching to reduce redundant API calls
- Implements TTL-based expiry to automatically clean up stale data
- Serves as the hot state layer, with Postgres as the durable fallback

### Requirements Validated

- **Requirement 16.1**: Maintains active session state, current schema progress, short-lived tool caches, pending UI state, and recent context summaries for active sessions
- **Requirement 16.3**: Session_Manager loads active session state from State_Store and falls back to Durable_Store when State_Store entry has expired

### API

#### Connection Management

```typescript
const store = new StateStore();
await store.connect();
await store.disconnect();
store.isConnected(); // boolean
```

#### Session State Methods

```typescript
// Set session state with TTL (defaults to env.operational.sessionTtlSeconds)
await store.setSessionState(sessionId, state, ttlSeconds?);

// Get session state (returns null if expired or not found)
const state = await store.getSessionState(sessionId);

// Delete session state
const deleted = await store.deleteSessionState(sessionId);
```

#### Tool Cache Methods

```typescript
// Set tool cache with TTL (defaults to 300 seconds = 5 minutes)
await store.setToolCache(cacheKey, entry, ttlSeconds?);

// Get tool cache entry (returns null if expired or not found)
const entry = await store.getToolCache(cacheKey);
```

### Usage Example

```typescript
import { getStateStore, initStateStore } from './services/index.js';

// Initialize on application startup
const stateStore = await initStateStore();

// Store session state
await stateStore.setSessionState('session_123', {
  currentIntent: 'search_hotels',
  currentStep: 'collect_location',
  activeSchema: 'hotel_search',
  schemaVersion: '1.0',
  missingFields: ['location', 'checkin_date'],
  collectedFields: {},
});

// Retrieve session state
const state = await stateStore.getSessionState('session_123');

// Cache tool results
await stateStore.setToolCache('search_hotels:hash123', {
  toolName: 'search_hotels',
  params: { location: 'Galle', checkin_date: '2026-05-01' },
  result: { hotels: [...] },
  timestamp: new Date(),
}, 300); // 5 minute TTL
```

### Configuration

The StateStore reads Redis configuration from environment variables:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional_password
REDIS_DB=0
SESSION_TTL_SECONDS=3600
```

### Testing

Run unit tests:

```bash
npm test src/services/StateStore.test.ts
```

The test suite covers:
- Connection management
- Session state CRUD operations
- Tool cache operations
- TTL expiry behavior
- Edge cases (unicode, special characters, complex data structures)

### Design Notes

1. **Singleton Pattern**: Use `getStateStore()` or `initStateStore()` to get the singleton instance
2. **TTL-Based Expiry**: All data has automatic expiry to prevent stale state accumulation
3. **Graceful Degradation**: Returns `null` for expired or missing entries, allowing fallback to Durable_Store
4. **Type Safety**: Strongly typed with TypeScript interfaces from `src/types/core.ts`
5. **Error Handling**: Logs parse errors but returns `null` rather than throwing, ensuring resilience

### Future Enhancements

- Add support for batch operations (multi-get, multi-set)
- Implement cache invalidation patterns
- Add metrics and monitoring hooks
- Support for Redis Cluster mode
- Implement cache warming strategies
