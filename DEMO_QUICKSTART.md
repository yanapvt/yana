# Demo Quick Start

The fastest way to see the bot in action.

---

## Option A: Real WhatsApp (Recommended)

### 1. Start the server
```bash
npm run dev
```

### 2. Expose it publicly
```bash
ngrok http 3000
```

### 3. Configure Twilio
Go to [Twilio WhatsApp Sandbox](https://console.twilio.com/us1/develop/sms/settings/whatsapp-sandbox) and set the webhook URL to:
```
https://your-ngrok-url.ngrok.io/webhook/whatsapp
```

### 4. Send a WhatsApp message
Send any message to your Twilio sandbox number (e.g. `+14155238886`).

**Try these:**
- `Hi` → numbered menu
- `3` → transport sub-menu
- `Best beach near Colombo?` → LLM reply
- `I need hotels and transport in Galle` → multi-intent list
- `Thanks` → instant reply (no LLM)

---

## Option B: HTTP Simulation

No WhatsApp needed. Simulate messages directly:

```bash
# Start server
npm run dev

# Simulate "Hi"
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp%3A%2B94770677470&To=whatsapp%3A%2B14155238886&Body=Hi&MessageSid=SM001"

# Simulate menu selection "3" (Transport)
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp%3A%2B94770677470&To=whatsapp%3A%2B14155238886&Body=3&MessageSid=SM002"

# Simulate a question
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp%3A%2B94770677470&To=whatsapp%3A%2B14155238886&Body=Best+beach+near+Colombo&MessageSid=SM003"
```

The server returns `200 OK` immediately (Twilio acknowledgement). The actual reply is sent asynchronously to WhatsApp — check the terminal logs to see what the reply would be.

---

## Option C: Demo Web UI

```bash
npm run dev
```

Open `http://localhost:3000/demo` in your browser for the interactive demo page.

---

## Health Check

```bash
curl http://localhost:3000/health
```

```json
{"status":"ok","timestamp":"2026-04-25T10:00:00.000Z","uptime":42.1}
```

---

## What to Look For in the Logs

```
[INFO ] [Webhook] Reply sent successfully {"replyLength":115}
```
→ Reply was sent to WhatsApp

```
[DEBUG] [LLMService] Short-circuit matched — no LLM call {"intent":"greeting"}
```
→ Greeting handled instantly without LLM

```
[DEBUG] [LLMService] Cache hit — no LLM call
```
→ Repeated question served from Redis

```
[DEBUG] [Webhook] Conversation history loaded {"historyLength":4}
```
→ Session memory is working (4 previous messages loaded)
