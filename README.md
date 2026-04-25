# YANA — Sri Lanka Tourist Concierge

A WhatsApp-first AI concierge for Sri Lanka tourists, built on a state-aware orchestration platform. Visitors can ask about places, food, transport, culture, and practical tips — and eventually book hotels and transport — entirely through WhatsApp.

**Branch:** `feature/whatsapp-session-memory` contains all active development.

---

## What Works Right Now

| Feature | Status |
|---|---|
| Receive WhatsApp messages via Twilio | ✅ |
| Interactive numbered menu on greeting | ✅ |
| Multi-intent detection ("hotels and transport") | ✅ |
| LLM-powered replies (Groq / llama-3.1-8b-instant) | ✅ |
| Conversation memory across messages (Postgres) | ✅ |
| Session state caching (Redis) | ✅ |
| Message deduplication (Redis) | ✅ |
| User and session persistence (Postgres) | ✅ |
| Graceful degradation when DB is unavailable | ✅ |
| LLM call optimisation (short-circuit + cache) | ✅ |
| Database migrations | ✅ |

**Not yet wired up:** hotel search API, transport booking, payment processing (infrastructure exists, not connected).

---

## Architecture

```
WhatsApp → Twilio → POST /webhook/whatsapp
                         │
                    ┌────▼────────────────────────────────┐
                    │  Middleware chain                    │
                    │  correlationId → rateLimit →        │
                    │  twilioSignature → deduplication    │
                    └────┬────────────────────────────────┘
                         │
                    ┌────▼────────────────────────────────┐
                    │  processAndReply()                  │
                    │                                     │
                    │  1. Load/create session (Postgres)  │
                    │  2. Load conversation history       │
                    │  3. Persist inbound message         │
                    │  4. decideAndReply() ──────────────►│
                    │     ├─ Menu selection? → 0 LLM calls│
                    │     ├─ Short-circuit?  → 0 LLM calls│
                    │     ├─ Multi-intent?   → 0 LLM calls│
                    │     ├─ Cache hit?      → 0 LLM calls│
                    │     └─ LLM call        → 1 API call │
                    │  5. Update session state (Redis+PG) │
                    │  6. Send reply via Twilio           │
                    │  7. Persist bot reply               │
                    └─────────────────────────────────────┘
```

### LLM call optimisation

Every inbound message goes through this decision tree before touching the LLM:

1. **Menu selection** — user replied "1"–"6" or typed a category name → instant reply, 0 LLM calls
2. **Short-circuit** — "Hi", "Thanks", "Yes", "No", "Bye", "Help" → instant reply, 0 LLM calls
3. **Multi-intent** — "hotels and transport in Galle" → numbered list, 0 LLM calls
4. **Redis cache** — same question asked before (10 min TTL) → cached reply, 0 LLM calls
5. **Single combined call** — decide intent + generate reply in one API call (was 2 calls previously)

---

## Quick Start (Local)

### Prerequisites

- Node.js 20+
- PostgreSQL 16 running on localhost:5432
- Redis running on localhost:6379
- Twilio account with WhatsApp Sandbox
- Groq API key (free at console.groq.com)

### 1. Install

```bash
git clone https://github.com/yanapvt/yana.git
cd yana
git checkout feature/whatsapp-session-memory
npm install
```

### 2. Configure `.env`

```env
NODE_ENV=development
PORT=3000

TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=+14155238886

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=yana_ogo
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_postgres_password

REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379

LLM_PROVIDER=groq
LLM_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
LLM_MODEL=llama-3.1-8b-instant
LLM_CONFIDENCE_THRESHOLD=0.85
```

### 3. Create database and run migrations

```bash
# Create the database (run once)
psql -U postgres -h localhost -c "CREATE DATABASE yana_ogo;"

# Run all migrations
npm run migrate
```

### 4. Start

```bash
npm run dev
```

Server starts on `http://localhost:3000`.

### 5. Expose to Twilio (ngrok)

Twilio needs a public URL to send webhooks. Use ngrok:

```bash
ngrok http 3000
```

Set the Twilio WhatsApp Sandbox webhook URL to:
```
https://your-ngrok-url.ngrok.io/webhook/whatsapp
```

Send a WhatsApp message to your Twilio sandbox number and you'll get a reply.

---

## Project Structure

```
src/
├── config/
│   ├── environment.ts      # Env var loading and validation
│   └── logger.ts           # Structured logger
├── db/
│   ├── connection.ts       # Postgres connection pool
│   ├── migrate.ts          # Migration runner
│   ├── migrations/         # SQL migration files (001–013)
│   └── repositories/       # Data access layer
├── middleware/
│   ├── correlationId.ts    # UUID per request
│   ├── deduplication.ts    # Redis-based message dedup
│   ├── rateLimiting.ts     # Per-phone rate limiting
│   └── twilioSignature.ts  # HMAC-SHA1 validation
├── routes/
│   └── webhook.ts          # POST /webhook/whatsapp + processAndReply()
├── services/
│   ├── LLMService.ts       # Groq/OpenAI calls, short-circuit, cache
│   ├── MenuService.ts      # Interactive menu system
│   ├── SessionManager.ts   # Session lifecycle + conversation history
│   ├── StateStore.ts       # Redis wrapper
│   ├── Orchestrator.ts     # LLM decision validation (built, not wired)
│   ├── MCPInterface.ts     # Tool call routing (built, not wired)
│   ├── ToolRegistry.ts     # Tool definitions (built, not wired)
│   ├── WhatsAppRenderer.ts # Message formatting (built, not wired)
│   └── adapters/
│       └── HotelSearchAdapter.ts  # Hotel search (built, not wired)
├── types/
│   └── core.ts             # All TypeScript interfaces
└── utils/
    └── messageNormalizer.ts # Twilio payload → InboundMessage
```

---

## NPM Scripts

```bash
npm run dev          # Start with hot reload (tsx watch)
npm run build        # Compile TypeScript
npm start            # Run compiled output
npm run migrate      # Run database migrations
npm test             # Run all tests
npm run lint         # ESLint
npm run format       # Prettier
```

---

## Deployment (GCP)

See [GCP_QUICKSTART.md](GCP_QUICKSTART.md) for a 5-minute setup, or [PRODUCTION_DEPLOYMENT_GCP.md](PRODUCTION_DEPLOYMENT_GCP.md) for the full guide.

**Important:** The database and migrations must be run manually before first deployment. The `cloudbuild.yaml` CI/CD pipeline does not run migrations automatically.

```bash
# One-time setup
./scripts/setup-gcp.sh

# Deploy
npm run deploy:gcp:run
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Environment |
| `PORT` | No | `3000` | HTTP port |
| `TWILIO_ACCOUNT_SID` | Prod only | — | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Prod only | — | Twilio auth token |
| `TWILIO_WHATSAPP_NUMBER` | Prod only | — | Your Twilio WhatsApp number |
| `POSTGRES_HOST` | Yes | `localhost` | Postgres host |
| `POSTGRES_PORT` | No | `5432` | Postgres port |
| `POSTGRES_DB` | Yes | `yana_ogo` | Database name |
| `POSTGRES_USER` | Yes | — | Postgres user |
| `POSTGRES_PASSWORD` | Yes | — | Postgres password |
| `REDIS_ENABLED` | No | `true` | Enable Redis |
| `REDIS_HOST` | No | `localhost` | Redis host |
| `REDIS_PORT` | No | `6379` | Redis port |
| `LLM_PROVIDER` | Yes | `groq` | `groq` or `openai` |
| `LLM_API_KEY` | Yes | — | API key |
| `LLM_MODEL` | No | `llama-3.1-8b-instant` | Model name |
| `LLM_CONFIDENCE_THRESHOLD` | No | `0.85` | Min confidence for decisions |

---

## Known Issues / Limitations

- **No actual bookings yet** — the bot can discuss hotels and transport but cannot make real bookings. The infrastructure (ToolRegistry, MCPInterface, HotelSearchAdapter) is built but not wired into the message flow.
- **Twilio Sandbox only** — the WhatsApp number is a shared sandbox. Production requires a Twilio WhatsApp Business account.
- **PostgreSQL must be started manually** on Windows — the service does not auto-start. Run `pg_ctl start` or start via Services.
- **No migration step in CI/CD** — migrations must be run manually before deploying to a new environment.
