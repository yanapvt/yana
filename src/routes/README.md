# Webhook Routes

## Overview

This directory contains the webhook endpoint implementation for receiving inbound WhatsApp messages from Twilio.

## Endpoint: POST /webhook/whatsapp

The main webhook ingress endpoint that handles all inbound WhatsApp messages.

### Requirements Implemented

- **Requirement 1.1**: Validates Twilio webhook signature on every request
- **Requirement 1.2**: Rejects and logs invalid signatures with Correlation_ID
- **Requirement 1.5**: Emits immediate HTTP 200 acknowledgement before expensive processing
- **Requirement 1.7**: Supports inbound message types (text, media, audio, interactive)
- **Requirement 18.1**: Enforces security controls on webhook signature validation

### Flow

1. **Correlation ID Assignment** (`assignCorrelationId` middleware)
   - Generates a unique UUID for the request
   - Adds to request headers for downstream processing
   - Adds to response headers for traceability

2. **Rate Limiting** (`webhookRateLimiter` middleware)
   - Limits requests per phone number to 30 per minute
   - Prevents abuse and excessive load
   - Logs rate limit violations with Correlation_ID

3. **Signature Validation** (`validateTwilioSignature` middleware)
   - Validates HMAC-SHA1 signature from Twilio
   - Uses timing-safe comparison to prevent timing attacks
   - Rejects invalid signatures with 403 status
   - Logs all rejections with Correlation_ID

4. **Message Normalization**
   - Converts Twilio webhook payload to `InboundMessage` type
   - Supports text, media, audio, and interactive messages
   - Preserves raw payload in metadata

5. **Immediate Acknowledgement**
   - Returns HTTP 200 to Twilio immediately
   - Prevents Twilio from retrying during processing
   - Queues message for async processing (TODO)

### Message Types Supported

#### Text Messages
```json
{
  "type": "text",
  "content": {
    "type": "text",
    "body": "Hello, I want to book a hotel"
  }
}
```

#### Interactive Messages (Button Reply)
```json
{
  "type": "interactive",
  "content": {
    "type": "interactive",
    "interactionType": "button_reply",
    "selectedId": "checkin_today",
    "selectedTitle": "Today"
  }
}
```

#### Interactive Messages (List Reply)
```json
{
  "type": "interactive",
  "content": {
    "type": "interactive",
    "interactionType": "list_reply",
    "selectedId": "hotel_123",
    "selectedTitle": "Luxury Beach Resort"
  }
}
```

#### Media Messages
```json
{
  "type": "media",
  "content": {
    "type": "media",
    "mediaType": "image",
    "mediaUrl": "https://example.com/image.jpg",
    "caption": "Check out this view!"
  }
}
```

#### Audio Messages
```json
{
  "type": "audio",
  "content": {
    "type": "audio",
    "audioUrl": "https://example.com/audio.ogg"
  }
}
```

### Security

- **Signature Validation**: All requests must have a valid Twilio signature
- **Rate Limiting**: 30 requests per minute per phone number
- **Correlation ID**: Every request is tracked end-to-end
- **Error Handling**: Errors are logged but don't prevent acknowledgement

### Testing

Run tests with:
```bash
npm test src/routes/webhook.test.ts
```

### Next Steps (TODO)

1. Implement async message processing queue
2. Integrate with Session Manager
3. Connect to Orchestrator for intent detection
4. Add LLM decision layer
5. Implement tool execution
6. Add WhatsApp response rendering
