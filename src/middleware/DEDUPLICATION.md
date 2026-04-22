# Webhook Deduplication Middleware

## Overview

The deduplication middleware prevents duplicate processing of inbound WhatsApp webhook deliveries by tracking processed message IDs in Redis. This ensures that if Twilio retries a webhook delivery (due to network issues, timeouts, etc.), the message is only processed once.

**Validates: Requirements 21.1**

## Implementation

### Key Components

1. **Middleware Function**: `deduplicateWebhook`
   - Extracts `MessageSid` from Twilio webhook payload
   - Checks Redis for existence of this message ID
   - If duplicate: returns HTTP 200 without processing
   - If new: stores message ID in Redis and proceeds to next middleware

2. **Redis Storage**
   - Key format: `webhook:message:{MessageSid}`
   - Value: Correlation ID (for traceability)
   - TTL: 24 hours (86400 seconds)

3. **Atomic Operation**
   - Uses Redis `SET NX` (set if not exists) with expiry
   - Atomic operation prevents race conditions
   - Thread-safe for concurrent webhook deliveries

### Integration

The middleware is integrated into the webhook route in the following order:

```typescript
router.post(
  '/webhook/whatsapp',
  assignCorrelationId,      // 1. Assign correlation ID
  webhookRateLimiter,        // 2. Apply rate limiting
  validateTwilioSignature,   // 3. Validate signature
  deduplicateWebhook,        // 4. Deduplicate (NEW)
  async (req, res) => {      // 5. Process message
    // ...
  }
);
```

### Behavior

#### First Delivery (New Message)
1. Extract `MessageSid` from payload
2. Check Redis: key does not exist
3. Store `MessageSid` in Redis with 24-hour TTL
4. Call `next()` to proceed with processing
5. Message is processed normally

#### Duplicate Delivery (Retry)
1. Extract `MessageSid` from payload
2. Check Redis: key exists
3. Log duplicate detection
4. Return HTTP 200 to Twilio
5. Skip all downstream processing

#### Missing MessageSid
1. Log warning
2. Call `next()` to proceed (fail-open)
3. Message is processed normally

#### Redis Failure
1. Log error
2. Call `next()` to proceed (fail-open)
3. Message is processed normally
4. Prevents blocking legitimate messages on Redis outage

## Design Decisions

### Why 24-Hour TTL?

Twilio's webhook retry window is typically much shorter (minutes to hours), but we use 24 hours to:
- Provide a safety margin for extended outages
- Allow for manual replay/debugging scenarios
- Balance memory usage with reliability

### Why Fail-Open?

When Redis is unavailable or MessageSid is missing, we proceed with processing rather than blocking. This is because:
- Availability is more important than perfect deduplication
- Duplicate processing is recoverable (idempotency at other layers)
- Blocking legitimate messages is worse than processing a duplicate

### Why Store Correlation ID?

We store the correlation ID as the value (not just a flag) to:
- Enable traceability: which request first processed this message
- Support debugging: correlate duplicate attempts with original processing
- Minimal overhead: correlation ID is already available

## Testing

### Unit Tests (`deduplication.test.ts`)

1. **First message allowed**: Verifies new messages proceed to next middleware
2. **Duplicate blocked**: Verifies duplicate messages return 200 without processing
3. **Different messages allowed**: Verifies different MessageSids are treated as unique
4. **Missing MessageSid**: Verifies graceful handling when MessageSid is absent
5. **Correlation ID storage**: Verifies correlation ID is stored with message ID
6. **TTL verification**: Verifies 24-hour TTL is set correctly

### Integration Tests (`webhook.test.ts`)

1. **MessageSid extraction**: Verifies MessageSid is correctly extracted from payload
2. **Unique identifier**: Verifies MessageSid is used as the deduplication key
3. **Different MessageSids**: Verifies different MessageSids are treated as unique

## Usage

The middleware is automatically applied to the `/webhook/whatsapp` endpoint. No additional configuration is required.

### Monitoring

To monitor deduplication in production:

```bash
# Check if a specific message was processed
redis-cli GET "webhook:message:SM1234567890abcdef"

# Count total tracked messages
redis-cli KEYS "webhook:message:*" | wc -l

# Check TTL for a message
redis-cli TTL "webhook:message:SM1234567890abcdef"
```

### Debugging

Duplicate detection is logged with the correlation ID:

```
[correlation-id] Duplicate message detected: SM1234567890abcdef, skipping processing
```

New messages are logged:

```
[correlation-id] New message: SM1234567890abcdef, proceeding with processing
```

## Future Enhancements

1. **Configurable TTL**: Make TTL configurable via environment variable
2. **Metrics**: Add metrics for duplicate rate, Redis failures
3. **Cleanup**: Add periodic cleanup job for expired keys (Redis handles this automatically)
4. **Distributed Tracing**: Integrate with distributed tracing system
