# Webhook Routes

## POST /webhook/whatsapp

The single inbound endpoint. Receives all WhatsApp messages from Twilio.

### Middleware chain (in order)

1. **`assignCorrelationId`** — generates a UUID for the request, adds to headers
2. **`webhookRateLimiter`** — 30 requests/minute per phone number
3. **`validateTwilioSignature`** — HMAC-SHA1 validation (skipped in development)
4. **`deduplicateWebhook`** — Redis `SET NX` check on `MessageSid` (24h TTL)

### Handler flow

After middleware, the handler:
1. Normalises the Twilio payload into an `InboundMessage`
2. Returns `200 OK` immediately to Twilio (prevents retries)
3. Calls `processAndReply()` asynchronously via `setImmediate`

### `processAndReply()` — the core pipeline

```
1. Load or create session (SessionManager → Redis → Postgres)
2. Load conversation history (last 20 turns from session_state)
3. Persist inbound message (messages table + session_state.conversation_history)
4. decideAndReply() — see LLMService.README.md for optimisation details
5. Update session state (currentIntent, collectedFields, activeSubMenu, pendingIntents)
6. Send reply via Twilio SDK
7. Persist bot reply to session history
```

Every DB/Redis operation in steps 1–3 and 5–7 is wrapped in try/catch. If the database is unavailable, the bot still replies (without session memory).

### Message types supported

| Twilio payload | Normalised type | `userText` extraction |
|---|---|---|
| `Body` present | `text` | `payload.Body` |
| `ButtonPayload` present | `interactive` (button_reply) | `ButtonText` |
| `ListId` present | `interactive` (list_reply) | `ListTitle` |
| `NumMedia > 0`, audio MIME | `audio` | `[audio message]` |
| `NumMedia > 0`, other | `media` | `[media message]` |

### Session state fields used

The webhook reads and writes these fields in `session_state.collected_fields`:

| Field | Type | Purpose |
|---|---|---|
| `activeSubMenu` | `string` | Which menu category is active (e.g. `'transport'`) |
| `pendingIntents` | `string[]` | Intents queued for sequential handling |

### Error handling

- Errors in the synchronous handler (normalisation) → logged, `200 OK` still sent
- Errors in `processAndReply()` → logged with `code`, `detail`, `stack`; Twilio already got its 200

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/webhook/whatsapp` | Inbound WhatsApp messages |
| `GET` | `/health` | Health check (defined in `app.ts`) |
| `GET/POST` | `/demo/*` | Demo endpoints (defined in `routes/demo.ts`) |
