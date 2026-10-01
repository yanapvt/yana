# Local OpenWA test procedure

This procedure is local-only. It does not enable booking, payment, staff publication,
alerts, native groups, or production traffic. Use a dedicated test WhatsApp account
and do not send to any contact or group without explicit recipient authorization.

## Configuration

Set these names in `.env`; never commit or paste their values into logs or evidence:

```dotenv
NODE_ENV=development
PORT=3000
WHATSAPP_PROVIDER=openwa
OPENWA_BASE_URL=http://localhost:2785
OPENWA_API_KEY=
OPENWA_SESSION_ID=
OPENWA_WEBHOOK_SECRET=
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=yana_ogo
REDIS_HOST=localhost
REDIS_PORT=6379
```

Configure the same webhook secret in OpenWA. If OpenWA runs in Docker, configure its
callback as `http://host.docker.internal:3000/webhook/openwa`. Otherwise use
`http://localhost:3000/webhook/openwa`.

## Safe startup

```powershell
docker compose up -d
npm.cmd run db:migrate
npm.cmd run build
npm.cmd run dev
```

In another terminal run `npm.cmd run openwa:smoke`. The smoke command performs only
health, TCP, session-status, and migration checks. It never sends a WhatsApp message
and never prints credentials, QR content, session payloads, or phone numbers.

If the OpenWA session is not paired, stop here. Open the local OpenWA UI yourself and
scan its QR code with the dedicated test account. Do not capture or paste the QR code.

## Authorized message test

Only after a test-recipient number is explicitly approved, send one harmless message
from that account to the paired session. Confirm one reply, then replay the identical
provider message ID and confirm no second processing or reply. Restart YANA and replay
again; it must remain a duplicate because Postgres is authoritative.

For outage checks, stop Redis while keeping Postgres available and repeat with a new
message ID; it should process once. With both Redis and Postgres unavailable, a new
delivery must receive HTTP 503 and cause no outbound message. Do not automatically
retry ambiguous outbound send failures because the provider may already have sent it.

## Session failure policy

- Active conversational state uses Redis first and a durable repository for restart
  or another app instance. A recovered session must keep the same normalized user ID.
- If Redis fails but durable storage works, continue from durable state.
- If a durable write fails, the current instance may continue memory-only, but restart
  and cross-instance continuity are not promised; log one redacted fallback event.
- If neither active nor durable state can be recovered, ask the traveler to resume or
  restart collection. Never infer a booking, payment, handoff, or confirmed inventory.
- Idempotency claims and hotel recheck receipts always fail closed when their durable
  store is unavailable.
