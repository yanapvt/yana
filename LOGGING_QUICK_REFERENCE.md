# Logging Quick Reference

## Environment Variables

```bash
# Enable/disable logging
LOG_ENABLED=true|false        # default: true

# Set verbosity level  
LOG_LEVEL=debug|info|warn|error  # default: auto (debug in dev, info in prod)
```

## Import Logger

```typescript
import { logger } from '../config/logger.js';
```

## Log Methods

```typescript
// Debug (detailed diagnostic information)
logger.debug('ContextName', 'Message', { metadata });

// Info (important events)
logger.info('ContextName', 'Message', { metadata });

// Warn (potential issues)
logger.warn('ContextName', 'Message', { metadata });

// Error (failures)
logger.error('ContextName', 'Message', { metadata });

// Trace async operations (auto logs entry/exit with timing)
const result = await logger.trace('Context', 'operation', async () => {
  // your async code
});
```

## Common Contexts

- `Platform` - Application startup/lifecycle
- `App` - Express application setup
- `HTTP` - HTTP requests/responses
- `Middleware` - Middleware execution
- `Webhook` - Webhook handler and processAndReply pipeline
- `Database` - Database operations
- `SessionManager` - Session lifecycle and conversation history
- `LLMService` - LLM interactions, short-circuit, cache
- `MenuService` - Interactive menu resolution
- `StateStore` - Redis operations
- `TwilioSignature` - Twilio validation
- `RateLimiter` - Rate limiting
- `Deduplication` - Message deduplication

## Examples

```typescript
// Service initialization
logger.info('ServiceName', 'Service initialized successfully', {
  configProperty: 'value',
});

// Request processing
logger.debug('Webhook', 'Processing request', {
  correlationId: req.headers['x-correlation-id'],
  from: payload.From,
});

// Error handling
logger.error('Database', 'Query failed', {
  error: err.message,
  sql: query,
});

// State changes
logger.info('SessionManager', 'Session updated', {
  sessionId,
  newState: 'active',
});

// Async operations
const data = await logger.trace('Repository', 'fetch users', () => {
  return userRepository.findAll();
});
```

## Configuration Examples

### Development (verbose)
```bash
LOG_ENABLED=true
LOG_LEVEL=debug
```

### Production (minimal)
```bash
LOG_ENABLED=true
LOG_LEVEL=info
```

### Disable logging
```bash
LOG_ENABLED=false
```

## Log Output Examples

```
[2026-04-25T10:30:45.123Z] [DEBUG] [SessionManager] Creating session { phoneNumber: "+1234567890", preferredLanguage: "en" }

[2026-04-25T10:30:45.456Z] [INFO] [SessionManager] New session created { sessionId: "sess-abc123", userId: "user-xyz" }

[2026-04-25T10:30:45.789Z] [WARN] [Deduplication] Duplicate message detected { correlationId: "req-123", messageId: "msg-456" }

[2026-04-25T10:30:46.012Z] [ERROR] [Database] Connection failed { error: "ECONNREFUSED", host: "localhost", port: 5432 }
```

## Tips

- Use `correlationId` from request headers for tracing: `req.headers['x-correlation-id']`
- Include IDs (sessionId, userId, messageId) in metadata for searchability
- Use `logger.trace()` for async operations to auto-log timing
- Filter by log level in production (info) to reduce log volume
- Set `LOG_ENABLED=false` to completely disable logging for performance testing
