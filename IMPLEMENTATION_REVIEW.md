# YANA Platform — Implementation Review

**Last Updated:** April 25, 2026
**Branch:** `feature/whatsapp-session-memory`

---

## Current Status: End-to-End WhatsApp Bot Working

The platform has moved well beyond scaffolding. A customer can now send a WhatsApp message and receive an intelligent, context-aware reply. Here is what is fully operational:

---

## ✅ What's Working

### Core Message Flow
- **Twilio webhook** receives inbound WhatsApp messages
- **Middleware chain** handles correlation IDs, rate limiting, signature validation (skipped in dev), and Redis-based deduplication
- **Session management** creates users and sessions on first contact, resumes existing sessions on subsequent messages
- **Conversation history** is loaded from Postgres and passed to the LLM on every message (last 6 turns)
- **LLM replies** are generated via Groq (llama-3.1-8b-instant) with the Sri Lanka concierge persona
- **Replies are sent** back to the user via Twilio WhatsApp API
- **Both the user message and bot reply** are persisted to the session history in Postgres

### Interactive Menu System
- Greeting ("Hi", "Hello", "Hey", "menu") triggers a formatted numbered menu with 6 categories
- User replies with a number (1–6) to select a category — no LLM call needed
- Categories with sub-items show a sub-menu (e.g. Transport → Tuk-tuk / Taxi / Train / Car Hire)
- Multi-intent detection: "I need hotels and transport" shows a numbered list of detected intents

### LLM Optimisation
- **Short-circuit rules**: greetings, thanks, yes/no, bye, help → 0 LLM calls, instant reply
- **Menu selections**: numbered replies → 0 LLM calls
- **Redis response cache**: informational answers cached 10 minutes → 0 LLM calls on repeat
- **Single combined call**: intent detection + reply generation merged into one API call (was 2)
- **History trimming**: only last 3 turns (6 messages) sent to keep prompts lean

### Infrastructure
- **Postgres** with 25 tables across 13 migrations (users, sessions, messages, bookings, payments, tools, audit logs, etc.)
- **Redis** for session state caching, tool result caching, and message deduplication
- **Graceful degradation**: if Postgres or Redis is unavailable, the bot still replies (without session memory)
- **Structured logging** throughout with correlation IDs, log levels, and metadata

---

## ⚠️ Built But Not Wired Up

These components are fully implemented and tested in isolation but are not yet called from the message processing pipeline:

| Component | What it does | Status |
|---|---|---|
| `Orchestrator` | Validates LLM decisions, enforces confidence thresholds | Built, not called |
| `MCPInterface` | Routes tool calls to adapters with retry logic | Built, not called |
| `ToolRegistry` | Stores tool definitions in DB | Built, no tools registered |
| `HotelSearchAdapter` | Searches hotels via provider API | Built, `performHttpRequest` is a stub |
| `NangoAdapter` | OAuth credential management | Built, `fetchTokenFromNango` throws |
| `SchemaEngine` | Collects required fields step-by-step | Built, not called |
| `WhatsAppRenderer` | Formats results as WhatsApp buttons/lists | Built, not called |
| `BookingRepository` | Stores booking records | Built, no booking flow |
| `PaymentRepository` | Stores payment records | Built, no payment flow |

---

## What Needs to Be Built Next

To enable actual hotel booking end-to-end:

1. **Wire the Orchestrator** into `processAndReply()` — after `decideAndReply()`, validate the decision before acting
2. **Wire the SchemaEngine** — when intent is `search_hotels`, collect missing fields (location, dates, guests) across multiple messages
3. **Implement `performHttpRequest`** in `NangoAdapter` — replace the stub with a real `fetch()` call to a hotel API
4. **Configure Nango** or bypass it and call provider APIs directly with API keys
5. **Register tools** at startup via `toolRegistry.registerTool()`
6. **Wire `MCPInterface`** — when Orchestrator says `execute_tool`, call `mcpInterface.executeToolCall()`
7. **Wire `WhatsAppRenderer`** — format hotel results as a WhatsApp list and send
8. **Build booking flow** — after user selects a hotel, collect payment info, call booking API, store in `bookings` table

Estimated effort: 2–3 weeks for hotel search + booking end-to-end.

---

## Architecture

```
WhatsApp → Twilio → POST /webhook/whatsapp
                         │
              ┌──────────▼──────────────────────┐
              │  Middleware                      │
              │  correlationId                  │
              │  → webhookRateLimiter            │
              │  → validateTwilioSignature       │
              │  → deduplicateWebhook (Redis)    │
              └──────────┬──────────────────────┘
                         │
              ┌──────────▼──────────────────────┐
              │  processAndReply()               │
              │                                  │
              │  SessionManager.resumeSession()  │◄── Redis + Postgres
              │  → load conversation history     │◄── Postgres
              │  → persist inbound message       │──► Postgres
              │                                  │
              │  LLMService.decideAndReply()     │
              │  ├─ MenuService (0 LLM calls)    │
              │  ├─ Short-circuit (0 LLM calls)  │
              │  ├─ Redis cache (0 LLM calls)    │
              │  └─ Groq API (1 LLM call)        │
              │                                  │
              │  SessionManager.updateState()    │──► Redis + Postgres
              │  twilioClient.messages.create()  │──► Twilio → WhatsApp
              │  → persist bot reply             │──► Postgres
              └──────────────────────────────────┘
```

---

## Database

25 tables across 13 migrations. Key tables in active use:

| Table | Used? | Purpose |
|---|---|---|
| `users` | ✅ | One row per phone number |
| `user_profiles` | ✅ | Language, currency preferences |
| `user_preferences` | ✅ | TTS, notifications |
| `user_language_settings` | ✅ | Behavioral memory |
| `sessions` | ✅ | One active session per user |
| `session_state` | ✅ | Intent, collected fields, conversation history |
| `messages` | ✅ | Every inbound and outbound message |
| `tool_registry` | ⚠️ | No tools registered yet |
| `tool_runs` | ⚠️ | No tool calls yet |
| `bookings` | ⚠️ | No booking flow yet |
| `payments` | ⚠️ | No payment flow yet |
| `audit_logs` | ⚠️ | Not populated yet |

---

## Known Issues

| Issue | Impact | Fix |
|---|---|---|
| PostgreSQL must be started manually on Windows | Bot fails silently on DB errors (graceful degradation kicks in) | Start service via `pg_ctl start` or Windows Services |
| No migration step in CI/CD | New environments need manual migration run | Run `npm run migrate` before first deploy |
| Twilio Sandbox shared number | All sandbox users share the same number | Requires WhatsApp Business account for production |
| `HotelSearchAdapter.performHttpRequest` throws | Hotel search cannot execute | Implement with real HTTP client |
| `NangoAdapter.fetchTokenFromNango` throws | OAuth-based providers cannot authenticate | Implement or bypass with direct API keys |
