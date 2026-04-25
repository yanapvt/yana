# YANA Platform — Testing Guide

**Last Updated:** April 25, 2026

---

## Testing the Live Bot (Primary Method)

The fastest way to test is to send a real WhatsApp message.

### Setup

1. Start the server: `npm run dev`
2. Expose it publicly: `ngrok http 3000`
3. Set Twilio Sandbox webhook to `https://your-ngrok-url/webhook/whatsapp`
4. Send a WhatsApp message to your Twilio sandbox number

### What to test

| Message | Expected behaviour |
|---|---|
| `Hi` | Numbered menu with 6 categories |
| `Hello` | Same menu |
| `menu` | Same menu |
| `1` | Places sub-menu (beaches, temples, nature, cities) |
| `3` | Transport sub-menu (tuk-tuk, taxi, train, car hire) |
| `4` | "Got it! Let me help you with Hotels & Stays..." |
| `Thanks` | "You're welcome! 😊 Need anything else?" |
| `Yes` | "Got it! Let me know what you'd like to do next." |
| `Bye` | Farewell message |
| `I need hotels and transport in Galle` | Multi-intent numbered list |
| `Best beach near Colombo?` | LLM reply about beaches |
| `What's the train from Colombo to Kandy like?` | LLM reply about trains |
| Send same question twice | Second reply comes from Redis cache (faster) |

### Checking the logs

The terminal running `npm run dev` shows structured logs for every step:

```
[DEBUG] [Webhook] Processing WhatsApp webhook
[INFO ] [Webhook] Message normalized successfully
[DEBUG] [SessionManager] Resuming session
[INFO ] [SessionManager] New session created   ← first message only
[DEBUG] [Webhook] Conversation history loaded {"historyLength":4}
[INFO ] [LLMService] Short-circuit matched — no LLM call  ← for greetings
[INFO ] [LLMService] Combined LLM call succeeded {"intent":"explore_places"}
[INFO ] [Webhook] Reply sent successfully {"replyLength":115}
[DEBUG] [SessionManager] Message appended successfully
```

Key things to verify:
- `historyLength` increases with each message (session memory working)
- `fromCache: true` appears on repeated questions (cache working)
- `shortCircuited: true` appears for greetings/thanks/yes/no (short-circuit working)
- `sessionId` is consistent across messages from the same number

---

## Automated Tests

```bash
# Run all tests
npm test

# Run a specific file
npm test -- src/services/SessionManager.test.ts

# Watch mode
npm run test:watch
```

### Test coverage by component

| Component | Tests | Notes |
|---|---|---|
| `SessionManager` | ✅ | Unit tests with mocked DB |
| `SchemaEngine` | ✅ | Validation and field collection |
| `LLMService` | ✅ | Mock provider responses |
| `StateStore` | ✅ | Mocked Redis |
| `MCPInterface` | ✅ | Tool call validation and routing |
| `ToolRegistry` | ✅ | Registration and retrieval |
| `MenuService` | ❌ | No tests yet |
| `HotelSearchAdapter` | ✅ | Normalisation logic |
| Property tests | ✅ | 10+ property-based tests |
| Integration tests | ❌ | Not yet implemented |

---

## Manual HTTP Testing

### Health check

```bash
curl http://localhost:3000/health
```

Expected:
```json
{"status":"ok","timestamp":"2026-04-25T10:00:00.000Z","uptime":123.4}
```

### Simulate a WhatsApp message

```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp%3A%2B94770677470&To=whatsapp%3A%2B14155238886&Body=Hi&MessageSid=SM123456789"
```

Expected: `200 OK` with empty body (Twilio acknowledgement). The actual reply goes to WhatsApp asynchronously.

### Simulate a menu selection

```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp%3A%2B94770677470&To=whatsapp%3A%2B14155238886&Body=3&MessageSid=SM987654321"
```

---

## Database Verification

After sending a few messages, verify data is being stored:

```bash
# Connect to the database
psql -U postgres -h localhost -d yana_ogo

# Check users
SELECT user_id, phone_number, created_at FROM users;

# Check sessions
SELECT session_id, user_id, last_activity_at FROM sessions;

# Check conversation history
SELECT session_id, jsonb_array_length(conversation_history) as turns
FROM session_state;

# Check messages
SELECT role, message_type, created_at FROM messages ORDER BY created_at DESC LIMIT 10;
```

---

## Redis Verification

```bash
# Connect to Redis
redis-cli

# Check session state
KEYS session:*

# Check deduplication keys
KEYS webhook:message:*

# Check LLM response cache
KEYS llm:reply:*

# Check TTL on a session
TTL session:<sessionId>:state
```

---

## Troubleshooting

### Bot not replying

1. Check Twilio webhook URL is set correctly in the Twilio Console
2. Check ngrok is running and the URL matches
3. Look for errors in the terminal logs — the error handler logs `code`, `detail`, and `stack`
4. Check `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in `.env` match your Twilio account

### "Database unavailable" warning in logs

```
[WARN] [Webhook] Database unavailable — proceeding without session context
```

- PostgreSQL is not running. Start it: `pg_ctl start -D "C:\Program Files\PostgreSQL\16\data"`
- Or credentials are wrong — check `POSTGRES_USER` and `POSTGRES_PASSWORD` in `.env`

### Session memory not working (historyLength always 0)

- Database is unavailable (see above)
- Or the `yana_ogo` database doesn't exist — run `npm run migrate`

### Same reply every time (no context awareness)

- Check `historyLength` in logs — if it's always 0, session memory isn't working
- Check the DB is connected and `session_state.conversation_history` is being populated

### Port 3000 already in use

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# Mac/Linux
lsof -ti:3000 | xargs kill -9
```
