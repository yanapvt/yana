# Comprehensive Logging Guide

## Overview

The YANA/OGO platform includes a fully configurable logging system that has been integrated throughout the codebase. Logging can be easily enabled and disabled as needed, and log levels can be controlled per environment.

## Logger Configuration

### Logger Implementation

The logger is implemented in `src/config/logger.ts` and provides a centralized, structured logging utility with the following features:

- **Structured logging** with context, message, and metadata
- **Multiple log levels**: `debug`, `info`, `warn`, `error`
- **Timestamp formatting** with ISO 8601 format
- **Error stack traces** automatically included
- **Async operation tracing** with timing measurements

### Environment Variables

Control logging behavior with these environment variables:

```bash
# Enable/disable logging globally
LOG_ENABLED=true|false   (default: true)

# Set log level
LOG_LEVEL=debug|info|warn|error   (default: debug in dev, info in prod)

# Example for production
LOG_ENABLED=true
LOG_LEVEL=info

# Example for development (verbose)
LOG_ENABLED=true
LOG_LEVEL=debug

# Example to disable logging
LOG_ENABLED=false
```

## Logger API

### Basic Usage

```typescript
import { logger } from './config/logger.js';

// Debug level - detailed diagnostic information
logger.debug('ContextName', 'Message text', { additionalData: 'value' });

// Info level - general informational messages
logger.info('ContextName', 'Important event occurred', { eventData: '...' });

// Warn level - warning messages for potentially problematic situations
logger.warn('ContextName', 'Something unexpected happened', { details: '...' });

// Error level - error messages for failures
logger.error('ContextName', 'An error occurred', { error: err.message, stack: err.stack });
```

### Advanced Usage - Trace Async Operations

```typescript
// Automatically logs entry/exit with execution time
const result = await logger.trace('ServiceName', 'operation name', async () => {
  // Your async operation
  return await someAsyncFunction();
});

// Output:
// [timestamp] [DEBUG] [ServiceName] → operation name
// [timestamp] [DEBUG] [ServiceName] ← operation name (1234ms)
//
// Or on error:
// [timestamp] [DEBUG] [ServiceName] → operation name
// [timestamp] [ERROR] [ServiceName] ✗ operation name failed (1234ms)
```

## Logging Across the Codebase

### 1. Entry Point (`src/index.ts`)
- Logs platform startup
- Logs environment configuration
- Logs server port and available endpoints

### 2. Express Application (`src/app.ts`)
- Logs application creation
- Logs middleware configuration
- Logs request details (method, path, content-type)
- Logs HTTP errors

### 3. Middleware

#### Correlation ID (`src/middleware/correlationId.ts`)
- Logs assignment of correlation ID to each request
- Includes method, path, and IP address

#### Twilio Signature Validation (`src/middleware/twilioSignature.ts`)
- Logs validation attempts
- Logs development mode bypass
- Logs signature validation failures with details

#### Rate Limiting (`src/middleware/rateLimiting.ts`)
- Logs when rate limit is exceeded
- Includes phone number and limit details

#### Deduplication (`src/middleware/deduplication.ts`)
- Logs duplicate message detection
- Logs new messages proceeding
- Logs Redis connection issues

### 4. Routes (`src/routes/webhook.ts`)
- Logs webhook payload processing
- Logs message normalization
- Logs message queuing for async processing
- Logs errors with error details

### 5. Database (`src/db/connection.ts`)
- Logs connection pool initialization
- Logs successful connections
- Logs connection pool errors
- Logs graceful shutdown

### 6. Services

#### SessionManager (`src/services/SessionManager.ts`)
- Logs session creation/resumption
- Logs new user/session detection
- Logs context package assembly
- Logs message appending
- Logs session state updates
- Logs language preference changes

#### LLMService (`src/services/LLMService.ts`)
- Logs service initialization
- Logs LLM decision requests
- Logs decision output with intent and confidence
- Logs UI content generation
- Logs LLM API calls
- Logs parsing errors with validation details

## Log Output Format

All logs follow this format:

```
[2026-04-25T10:30:45.123Z] [LEVEL] [Context] Message text { metadata }
```

Examples:

```
[2026-04-25T10:30:45.123Z] [DEBUG] [Platform] YANA / OGO Platform starting...
[2026-04-25T10:30:45.124Z] [INFO] [Platform] Server started { port: 3000 }
[2026-04-25T10:30:45.125Z] [DEBUG] [Middleware] New request { correlationId: "abc-123", method: "POST", path: "/webhook/whatsapp" }
[2026-04-25T10:30:45.200Z] [INFO] [Webhook] Message normalized successfully { correlationId: "abc-123", from: "+1234567890", type: "text" }
[2026-04-25T10:30:45.300Z] [INFO] [SessionManager] New session created { sessionId: "sess-123", userId: "user-456" }
[2026-04-25T10:30:45.400Z] [INFO] [LLMService] LLM decision made successfully { intent: "search_hotels", confidence: 0.92 }
[2026-04-25T10:30:45.500Z] [ERROR] [Database] Connection check failed { error: "ECONNREFUSED" }
```

## Configuring Logging by Environment

### Development Environment

```bash
# .env.development
NODE_ENV=development
LOG_ENABLED=true
LOG_LEVEL=debug
```

**Result**: Verbose logging of all operations including debug details

### Staging Environment

```bash
# .env.staging
NODE_ENV=staging
LOG_ENABLED=true
LOG_LEVEL=debug
```

**Result**: Verbose logging for troubleshooting in staging

### Production Environment

```bash
# .env.production
NODE_ENV=production
LOG_ENABLED=true
LOG_LEVEL=info
```

**Result**: Only important events logged; debug messages suppressed

### Minimal/No Logging

```bash
# For performance testing or when logs aren't needed
LOG_ENABLED=false
```

**Result**: All logging disabled

## Best Practices

### 1. Use Appropriate Log Levels

- **DEBUG**: Detailed diagnostic information useful for troubleshooting
  - Variable values
  - Function entry/exit points
  - Detailed state changes
  
- **INFO**: General informational messages about application progress
  - Service initialization
  - Session creation
  - Important business events
  
- **WARN**: Warning messages for potentially problematic situations
  - Duplicate message detection
  - Signature validation bypass
  - Missing optional data
  
- **ERROR**: Error messages for failures
  - Exceptions
  - Database connection failures
  - Invalid operations

### 2. Use Descriptive Context Names

```typescript
// Good - specific context
logger.info('SessionManager', 'Session created', { sessionId });

// Less specific - still acceptable
logger.info('Service', 'Session created', { sessionId });

// Avoid - too generic
logger.info('App', 'Session created', { sessionId });
```

### 3. Include Relevant Metadata

```typescript
// Good - includes identification info
logger.debug('SessionManager', 'Creating session', {
  phoneNumber,
  preferredLanguage,
  preferredCurrency,
});

// Less useful - no context
logger.debug('SessionManager', 'Creating session');
```

### 4. Log Errors with Full Details

```typescript
// Good - includes error context
logger.error('Database', 'Connection failed', {
  error: err.message,
  stack: err.stack,
  host: env.postgres.host,
  port: env.postgres.port,
});

// Minimal - lacks context
logger.error('Database', 'Connection failed', { error: err.message });
```

### 5. Use Correlation IDs

All logs should include the correlation ID when available:

```typescript
const correlationId = req.headers['x-correlation-id'] as string;
logger.info('Webhook', 'Processing message', {
  correlationId,
  messageId: msg.id,
  from: msg.from,
});
```

## Troubleshooting

### Logs Not Appearing

1. Check `LOG_ENABLED` environment variable
   ```bash
   echo $LOG_ENABLED  # Should be 'true' or not set
   ```

2. Check `LOG_LEVEL` setting
   ```bash
   echo $LOG_LEVEL  # Should be 'debug' for development
   ```

3. Verify logger is imported correctly
   ```typescript
   import { logger } from './config/logger.js';  // Correct
   ```

### Too Many Logs in Production

```bash
# Set to info level to suppress debug messages
LOG_LEVEL=info
```

### Logs Missing Session Context

Ensure correlation ID is passed through the request:

```typescript
const correlationId = req.headers['x-correlation-id'] as string;
logger.info('Component', 'Action', { correlationId, ...otherData });
```

## Performance Considerations

- Logger checks `LOG_ENABLED` before formatting any logs
- Conditional logging prevents unnecessary string concatenation
- Async operation tracing has minimal overhead
- Using `logger.trace()` is recommended for async operations

## Integration with External Logging Services

The logger can be extended to integrate with external services like Google Cloud Logging, Datadog, or ELK stack:

```typescript
// In src/config/logger.ts, you can add:
export const logger = {
  debug(context: string, message: string, meta?: unknown): void {
    if (shouldLog('debug')) {
      const formatted = format('debug', context, message, meta);
      console.debug(formatted);
      
      // Send to external service
      if (process.env.USE_CLOUD_LOGGING === 'true') {
        sendToCloudLogging('DEBUG', formatted);
      }
    }
  },
  // ... similar for other levels
};
```

## Summary

The logging system in YANA/OGO is:

✅ **Enabled/Disabled** - Control via `LOG_ENABLED` environment variable
✅ **Configurable** - Set log level via `LOG_LEVEL` environment variable  
✅ **Comprehensive** - Integrated across all major components
✅ **Structured** - Includes context, message, and metadata
✅ **Traceable** - Uses correlation IDs for request tracking
✅ **Performant** - Minimal overhead when disabled
