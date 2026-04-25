# 🔍 YANA/OGO Platform - Comprehensive Logging Guide

## Overview

The platform includes a powerful logging system that helps you debug and trace requests through the entire system. You can control what gets logged and at what level of detail.

---

## Quick Start

### **Enable Debug Logging**

Add to your `.env` file:

```bash
LOG_LEVEL=DEBUG
LOG_CATEGORIES=ALL
LOG_STACK_TRACE=true
```

Restart your server:
```bash
npm run dev
```

### **Disable Verbose Logging** (Production)

```bash
LOG_LEVEL=INFO
LOG_CATEGORIES=WEBHOOK,SESSION,BOOKING,PAYMENT
LOG_STACK_TRACE=false
```

---

## Log Levels

Control how much detail you see:

| Level | Value | Description | Use When |
|-------|-------|-------------|----------|
| **ERROR** | 0 | Only errors | Production - critical issues only |
| **WARN** | 1 | Warnings + errors | Production - potential issues |
| **INFO** | 2 | Important events | Production - normal operation |
| **DEBUG** | 3 | Detailed flow | Development - debugging |
| **TRACE** | 4 | Everything | Development - deep debugging |

### **Examples:**

```bash
# Production - minimal logging
LOG_LEVEL=ERROR

# Development - see what's happening
LOG_LEVEL=DEBUG

# Deep debugging - see every function call
LOG_LEVEL=TRACE
```

---

## Log Categories

Filter logs by component:

| Category | What It Logs |
|----------|--------------|
| **WEBHOOK** | Incoming WhatsApp messages, signature validation |
| **SESSION** | Session creation, loading, state updates |
| **ORCHESTRATOR** | Main decision flow, routing logic |
| **LLM** | LLM API calls, responses, confidence scores |
| **SCHEMA** | Schema validation, field collection |
| **TOOL** | Tool execution, MCP interface |
| **PROVIDER** | External API calls (hotels, payments) |
| **BOOKING** | Booking lifecycle, state transitions |
| **PAYMENT** | Payment processing, webhooks |
| **TRANSLATION** | Language detection, translation |
| **WHATSAPP** | Message rendering, sending |
| **DATABASE** | Database queries, connections |
| **REDIS** | Redis operations, caching |
| **MIDDLEWARE** | Middleware execution (auth, rate limiting) |
| **GENERAL** | System-wide events |

### **Examples:**

```bash
# See everything
LOG_CATEGORIES=ALL

# Only webhook and session logs
LOG_CATEGORIES=WEBHOOK,SESSION

# Debug booking and payment flow
LOG_CATEGORIES=BOOKING,PAYMENT,PROVIDER

# Trace LLM and schema processing
LOG_CATEGORIES=LLM,SCHEMA,ORCHESTRATOR
```

---

## Configuration Options

### **Environment Variables**

```bash
# Log level (ERROR, WARN, INFO, DEBUG, TRACE)
LOG_LEVEL=DEBUG

# Categories to log (ALL or comma-separated list)
LOG_CATEGORIES=ALL

# Show timestamps (true/false)
LOG_TIMESTAMP=true

# Colorize output (true/false)
LOG_COLORS=true

# Show full stack traces for errors (true/false)
LOG_STACK_TRACE=true
```

---

## Usage in Code

### **Basic Logging**

```typescript
import { logger, LogCategory } from '../utils/logger';

// Error
logger.error(
  LogCategory.WEBHOOK,
  'Failed to process webhook',
  correlationId,
  { messageId: 'SM123' },
  error
);

// Warning
logger.warn(
  LogCategory.SESSION,
  'Session not found in cache, loading from database',
  correlationId
);

// Info
logger.info(
  LogCategory.BOOKING,
  'Booking confirmed',
  correlationId,
  { bookingId: 'BK123', hotelName: 'Galle Face Hotel' }
);

// Debug
logger.debug(
  LogCategory.SCHEMA,
  'Checking missing fields',
  correlationId,
  { required: ['location', 'date'], collected: ['location'] }
);

// Trace
logger.trace(
  LogCategory.LLM,
  'Calling LLM API',
  correlationId,
  { model: 'gpt-4', tokens: 1500 }
);
```

### **Function Entry/Exit Tracking**

```typescript
import { logger, LogCategory } from '../utils/logger';

async function processBooking(bookingId: string, correlationId: string) {
  logger.entering(
    LogCategory.BOOKING,
    'processBooking',
    correlationId,
    { bookingId }
  );

  try {
    // ... your code ...
    
    logger.exiting(
      LogCategory.BOOKING,
      'processBooking',
      correlationId,
      { success: true }
    );
  } catch (error) {
    logger.error(
      LogCategory.BOOKING,
      'processBooking failed',
      correlationId,
      { bookingId },
      error as Error
    );
    throw error;
  }
}
```

### **Performance Timing**

```typescript
import { logger, LogCategory, measureTime } from '../utils/logger';

// Automatic timing
const result = await measureTime(
  LogCategory.PROVIDER,
  'Hotel API call',
  correlationId,
  async () => {
    return await hotelApi.search(params);
  }
);

// Manual timing
logger.timing(
  LogCategory.DATABASE,
  'Database query',
  executionTimeMs,
  correlationId
);
```

---

## Common Debugging Scenarios

### **Scenario 1: Request Gets Stuck**

**Enable:**
```bash
LOG_LEVEL=TRACE
LOG_CATEGORIES=ALL
```

**Look for:**
- Last log entry before it stops
- Missing "Exiting" logs (function didn't complete)
- Long gaps between timestamps

### **Scenario 2: LLM Not Responding**

**Enable:**
```bash
LOG_LEVEL=DEBUG
LOG_CATEGORIES=LLM,ORCHESTRATOR
```

**Look for:**
- LLM API call logs
- Response time
- Confidence scores
- Error messages

### **Scenario 3: Database Issues**

**Enable:**
```bash
LOG_LEVEL=DEBUG
LOG_CATEGORIES=DATABASE,SESSION
```

**Look for:**
- Connection errors
- Query failures
- Slow queries (timing logs)

### **Scenario 4: Redis/Caching Issues**

**Enable:**
```bash
LOG_LEVEL=DEBUG
LOG_CATEGORIES=REDIS,SESSION
```

**Look for:**
- Connection status
- Cache hits/misses
- Expiry issues

### **Scenario 5: Payment Webhook Not Processing**

**Enable:**
```bash
LOG_LEVEL=DEBUG
LOG_CATEGORIES=WEBHOOK,PAYMENT,MIDDLEWARE
```

**Look for:**
- Webhook signature validation
- Deduplication checks
- Payment state transitions

---

## Log Output Examples

### **TRACE Level (Most Verbose)**

```
[2026-04-24T14:00:00.123Z] [corr_abc123] [TRACE] [WEBHOOK] → Entering validateTwilioSignature
[2026-04-24T14:00:00.125Z] [corr_abc123] [TRACE] [WEBHOOK] ← Exiting validateTwilioSignature { valid: true }
[2026-04-24T14:00:00.126Z] [corr_abc123] [TRACE] [SESSION] → Entering resumeSession { phoneNumber: "+94777269221" }
[2026-04-24T14:00:00.130Z] [corr_abc123] [DEBUG] [REDIS] Cache miss for session:sess_123
[2026-04-24T14:00:00.145Z] [corr_abc123] [DEBUG] [DATABASE] Loading session from Postgres
[2026-04-24T14:00:00.167Z] [corr_abc123] [TRACE] [SESSION] ← Exiting resumeSession { sessionId: "sess_123" }
[2026-04-24T14:00:00.168Z] [corr_abc123] [DEBUG] [SESSION] ⏱️  resumeSession took 42ms
```

### **DEBUG Level (Detailed)**

```
[2026-04-24T14:00:00.200Z] [corr_abc123] [DEBUG] [ORCHESTRATOR] Processing message: "I need a hotel in Galle"
[2026-04-24T14:00:00.201Z] [corr_abc123] [DEBUG] [LLM] Calling LLM API { model: "gpt-4", tokens: 1500 }
[2026-04-24T14:00:01.456Z] [corr_abc123] [DEBUG] [LLM] ⏱️  LLM API call took 1255ms
[2026-04-24T14:00:01.457Z] [corr_abc123] [DEBUG] [LLM] LLM response { intent: "search_hotels", confidence: 0.95 }
[2026-04-24T14:00:01.458Z] [corr_abc123] [DEBUG] [SCHEMA] Checking missing fields { required: ["location", "checkin_date"], collected: ["location"] }
```

### **INFO Level (Important Events)**

```
[2026-04-24T14:00:00.100Z] [corr_abc123] [INFO] [WEBHOOK] New message from whatsapp:+94777269221
[2026-04-24T14:00:01.500Z] [corr_abc123] [INFO] [BOOKING] Booking initiated { bookingId: "BK123", hotel: "Galle Face Hotel" }
[2026-04-24T14:00:02.800Z] [corr_abc123] [INFO] [PAYMENT] Payment successful { paymentId: "PAY456", amount: 300 }
[2026-04-24T14:00:03.100Z] [corr_abc123] [INFO] [BOOKING] Booking confirmed { bookingId: "BK123" }
```

### **ERROR Level (Errors Only)**

```
[2026-04-24T14:00:05.000Z] [corr_abc123] [ERROR] [PROVIDER] Hotel API call failed { error: "Timeout after 30s" }
Error: Request timeout
    at HotelSearchAdapter.execute (src/services/adapters/HotelSearchAdapter.ts:45:11)
    at MCPInterface.executeToolCall (src/services/MCPInterface.ts:123:22)
```

---

## Performance Tips

### **Production Settings**

```bash
# Minimal overhead
LOG_LEVEL=WARN
LOG_CATEGORIES=WEBHOOK,BOOKING,PAYMENT
LOG_TIMESTAMP=true
LOG_COLORS=false
LOG_STACK_TRACE=false
```

### **Development Settings**

```bash
# Maximum visibility
LOG_LEVEL=DEBUG
LOG_CATEGORIES=ALL
LOG_TIMESTAMP=true
LOG_COLORS=true
LOG_STACK_TRACE=true
```

### **Debugging Specific Issue**

```bash
# Only log what you need
LOG_LEVEL=TRACE
LOG_CATEGORIES=LLM,SCHEMA,ORCHESTRATOR
LOG_STACK_TRACE=true
```

---

## Log Rotation (Production)

For production, use a log management service:

### **Option 1: Winston + CloudWatch**

```bash
npm install winston winston-cloudwatch
```

### **Option 2: Pino + Datadog**

```bash
npm install pino pino-datadog
```

### **Option 3: Built-in GCP Logging**

Logs automatically sent to Google Cloud Logging when deployed on GCP.

---

## Troubleshooting

### **Problem: Too Many Logs**

**Solution:**
```bash
# Reduce log level
LOG_LEVEL=INFO

# Filter categories
LOG_CATEGORIES=WEBHOOK,BOOKING,PAYMENT
```

### **Problem: Not Seeing Logs**

**Solution:**
```bash
# Check log level is high enough
LOG_LEVEL=DEBUG

# Check category is enabled
LOG_CATEGORIES=ALL
```

### **Problem: Can't Find Where It's Stuck**

**Solution:**
```bash
# Enable TRACE level
LOG_LEVEL=TRACE

# Enable all categories
LOG_CATEGORIES=ALL

# Look for last log entry before hang
```

### **Problem: Logs Too Slow**

**Solution:**
```bash
# Disable colors in production
LOG_COLORS=false

# Reduce log level
LOG_LEVEL=WARN

# Filter categories
LOG_CATEGORIES=WEBHOOK,BOOKING,PAYMENT
```

---

## Best Practices

1. **Always include correlation ID** - Trace requests end-to-end
2. **Use appropriate log levels** - Don't log everything at ERROR
3. **Include context data** - Add relevant IDs, states, values
4. **Measure performance** - Use timing logs for slow operations
5. **Filter in production** - Only log what you need
6. **Use categories** - Makes filtering easier
7. **Enable stack traces for errors** - Helps debugging
8. **Disable colors in production** - Reduces overhead

---

## Quick Reference

```bash
# See everything (debugging)
LOG_LEVEL=TRACE LOG_CATEGORIES=ALL npm run dev

# Normal development
LOG_LEVEL=DEBUG LOG_CATEGORIES=ALL npm run dev

# Production
LOG_LEVEL=INFO LOG_CATEGORIES=WEBHOOK,BOOKING,PAYMENT npm start

# Debug specific component
LOG_LEVEL=DEBUG LOG_CATEGORIES=LLM,SCHEMA npm run dev

# Find where it's stuck
LOG_LEVEL=TRACE LOG_CATEGORIES=ALL LOG_STACK_TRACE=true npm run dev
```

---

**Happy debugging! 🔍**
