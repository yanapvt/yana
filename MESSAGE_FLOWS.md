# YANA — Message Flow Reference

Every possible path a message takes from WhatsApp to a reply, based on the actual code.

---

## The Shared Entry Path (All Messages)

Every single message — regardless of content — goes through this sequence first:

```
User sends WhatsApp message
        │
        ▼
Twilio receives it and POSTs to:
POST /webhook/whatsapp
        │
        ▼
┌───────────────────────────────────────────────────────┐
│  MIDDLEWARE CHAIN (synchronous, in order)             │
│                                                       │
│  1. assignCorrelationId                               │
│     └─ Generates UUID, attaches to request headers   │
│                                                       │
│  2. webhookRateLimiter                                │
│     └─ 30 req/min per phone number                   │
│     └─ If exceeded → 429, Twilio will retry later    │
│                                                       │
│  3. validateTwilioSignature                           │
│     └─ Development: skipped (logged as WARN)         │
│     └─ Production: HMAC-SHA1 check                   │
│     └─ If invalid → 403, message dropped             │
│                                                       │
│  4. deduplicateWebhook                                │
│     └─ Redis SET NX on MessageSid (24h TTL)          │
│     └─ If duplicate → 200 OK, processing skipped     │
│     └─ If Redis down → proceed (fail-open)           │
└───────────────────────────────────────────────────────┘
        │
        ▼
normalizeInboundMessage(payload)
  Converts Twilio form data → InboundMessage
  Extracts: from, to, type, content, messageId
        │
        ▼
res.status(200).send('')   ← Twilio gets its ACK immediately
        │
        ▼
setImmediate(() => processAndReply(...))
  ← Everything below runs asynchronously
```

---

## Inside processAndReply() — Session Setup (All Messages)

After the 200 is sent, every message goes through this session setup:

```
┌─────────────────────────────────────────────────────────────┐
│  SESSION SETUP                                              │
│                                                             │
│  SessionManager.resumeSession(phoneNumber)                  │
│    ├─ UserRepository.findByPhoneNumber()  → Postgres        │
│    ├─ SessionRepository.findActiveByUserId() → Postgres     │
│    ├─ StateStore.getSessionState(sessionId) → Redis         │
│    └─ Falls back to Postgres if Redis miss                  │
│                                                             │
│  If user/session not found:                                 │
│    SessionManager.createSession()                           │
│      ├─ Creates row in: users                               │
│      ├─ Creates row in: user_profiles                       │
│      ├─ Creates row in: user_preferences                    │
│      ├─ Creates row in: user_language_settings              │
│      ├─ Creates row in: sessions                            │
│      └─ Creates row in: session_state                       │
│                                                             │
│  If DB unavailable:                                         │
│    sessionId = null, contextPackage = null                  │
│    Bot continues WITHOUT session memory                     │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  CONVERSATION HISTORY LOAD                                  │
│                                                             │
│  SessionRepository.getState(sessionId)                      │
│    └─ Reads session_state.conversation_history (JSONB)      │
│    └─ Takes last 20 entries                                 │
│    └─ Normalises content to plain strings                   │
│                                                             │
│  If DB unavailable: conversationHistory = []                │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  PERSIST INBOUND MESSAGE                                    │
│                                                             │
│  SessionManager.appendMessage(sessionId, { role: 'user' })  │
│    ├─ MessageRepository.createMessage() → messages table    │
│    └─ SessionRepository.appendConversationHistory()         │
│         → appends to session_state.conversation_history     │
│                                                             │
│  If DB unavailable: silently skipped                        │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
  [decideAndReply() — see flows below]
```

---

## Flow 1 — Greeting / Help (0 LLM calls)

**Triggers:** `Hi`, `Hello`, `Hey`, `Good morning`, `Good evening`, `Start`, `Menu`, `Help`, `?`, `What can you do`

```
userText matches SHORT_CIRCUIT_RULES pattern
        │
        ▼
LLMService.tryShortCircuit(userText)
        │
        ▼
MenuService.renderMainMenu()
  Returns formatted text:
  ┌─────────────────────────────────────────┐
  │ 👋 Welcome to *Yana* — your Sri Lanka   │
  │ concierge!                              │
  │                                         │
  │ *1.* 🏖 Places to Visit                 │
  │     _Beaches, temples, parks..._        │
  │ *2.* 🍛 Food & Restaurants              │
  │     _Local cuisine, street food..._     │
  │ *3.* 🚌 Transport                       │
  │     _Tuk-tuks, trains, taxis..._        │
  │ *4.* 🏨 Hotels & Stays                  │
  │     _Find and book accommodation_       │
  │ *5.* 🎭 Culture & Tips                  │
  │     _Customs, festivals, safety..._     │
  │ *6.* 🆘 Emergency & Help                │
  │     _Hospitals, police, embassy..._     │
  └─────────────────────────────────────────┘
        │
        ▼
decision = { intent: 'greeting', confidence: 1.0, shortCircuited: true }
        │
        ▼
Session state updated:
  currentIntent = 'greeting'
        │
        ▼
Twilio sends reply to user
        │
        ▼
Bot reply persisted to session_state.conversation_history
```

**LLM calls: 0 | Latency: ~5ms**

---

## Flow 2 — Simple Acknowledgement (0 LLM calls)

**Triggers:** `Thanks`, `Thank you`, `Great`, `Awesome`, `Perfect`, `Yes`, `Yeah`, `Ok`, `No`, `Nope`, `Cancel`, `Bye`, `Goodbye`

```
userText matches SHORT_CIRCUIT_RULES pattern
        │
        ▼
LLMService.tryShortCircuit(userText)
        │
        ▼
Returns hardcoded reply string, e.g.:
  "You're welcome! 😊 Need anything else? Reply *menu* to see all options."
  "Got it! Let me know what you'd like to do next. 😊"
  "No problem! Reply *menu* anytime to start over. 😊"
  "Goodbye! 🌴 Have a wonderful time in Sri Lanka."
        │
        ▼
decision = { intent: 'acknowledgement'/'confirmation'/'farewell', shortCircuited: true }
        │
        ▼
Twilio sends reply to user
```

**LLM calls: 0 | Latency: ~5ms**

---

## Flow 3 — Main Menu Selection (0 LLM calls)

**Triggers:** User replies with `1`, `2`, `3`, `4`, `5`, or `6` (or category name/emoji)

### 3a — Category without sub-items (e.g. `4` = Hotels)

```
userText = "4"
        │
        ▼
MenuService.resolveMenuSelection("4", activeSubMenu=undefined)
  numMatch = true, index = 3
  MAIN_MENU[3] = { id: 'hotels', intent: 'search_hotels' }
  item has no subItems
        │
        ▼
replyText = "Got it! Let me help you with *Hotels & Stays*. What would you like to know? 😊"
        │
        ▼
decision = { intent: 'search_hotels', shortCircuited: true }
        │
        ▼
Session state updated:
  currentIntent = 'search_hotels'
  collectedFields.activeSubMenu = 'hotels'  ← NOT set (no sub-menu)
        │
        ▼
Twilio sends reply
```

### 3b — Category with sub-items (e.g. `3` = Transport)

```
userText = "3"
        │
        ▼
MenuService.resolveMenuSelection("3", activeSubMenu=undefined)
  numMatch = true, index = 2
  MAIN_MENU[2] = { id: 'transport', intent: 'explore_transport', subItems: [...] }
  item HAS subItems
        │
        ▼
MenuService.renderSubMenu(transportItem)
  Returns:
  ┌─────────────────────────────────────────┐
  │ 🚌 *Transport* — what specifically?    │
  │                                         │
  │ *1.* 🛺 Tuk-tuk                         │
  │ *2.* 🚕 Taxi / Cab                      │
  │ *3.* 🚂 Train                           │
  │ *4.* 🚗 Car Hire                        │
  │                                         │
  │ _Or just describe what you're looking   │
  │ for!_                                   │
  └─────────────────────────────────────────┘
        │
        ▼
decision = { intent: 'explore_transport', shortCircuited: true }
activeSubMenu = 'transport'
        │
        ▼
Session state updated:
  currentIntent = 'explore_transport'
  collectedFields.activeSubMenu = 'transport'  ← stored for next message
        │
        ▼
Twilio sends sub-menu
```

**LLM calls: 0 | Latency: ~10ms**

---

## Flow 4 — Sub-menu Selection (0 LLM calls)

**Triggers:** User replies `1`–`4` AFTER a sub-menu was shown (activeSubMenu is set in session)

```
userText = "2"
activeSubMenu = 'transport'  ← loaded from session_state.collectedFields
        │
        ▼
MenuService.resolveMenuSelection("2", activeSubMenu='transport')
  numMatch = true, index = 1
  parent = MAIN_MENU.find(m => m.id === 'transport')
  parent.subItems[1] = { id: 'transport_taxi', intent: 'book_taxi', label: 'Taxi / Cab' }
  isSub = true
        │
        ▼
replyText = "Got it! Let me help you with *Taxi / Cab*. What would you like to know? 😊"
        │
        ▼
decision = { intent: 'book_taxi', shortCircuited: true }
activeSubMenu = undefined  ← cleared (sub-item selected, no deeper menu)
        │
        ▼
Session state updated:
  currentIntent = 'book_taxi'
  collectedFields.activeSubMenu deleted
        │
        ▼
Twilio sends reply
```

**LLM calls: 0 | Latency: ~10ms**

---

## Flow 5 — Multi-Intent Detection (0 LLM calls)

**Triggers:** Free-text message containing keywords for 2+ categories

**Example:** `"I need hotels and transport in Galle"`

```
userText = "I need hotels and transport in Galle"
        │
        ▼
No short-circuit match
No menu selection match (not a number)
        │
        ▼
MenuService.detectMultipleIntents(userText)
  Checks each MAIN_MENU item's keywords against lowercased text:
  'hotels' keywords: ['hotel','stay','accommodation',...] → 'hotel' found ✓
  'transport' keywords: ['transport','travel','tuk','taxi',...] → 'transport' found ✓
  matched = [hotels item, transport item]
  matched.length >= 2 → multi-intent detected
        │
        ▼
replyText:
  ┌─────────────────────────────────────────┐
  │ Looks like you need help with a few     │
  │ things! Let's tackle them one by one 😊 │
  │                                         │
  │ *1.* 🏨 Hotels & Stays                  │
  │ *2.* 🚌 Transport                       │
  │                                         │
  │ Which would you like to start with?     │
  │ Reply with a number.                    │
  └─────────────────────────────────────────┘
        │
        ▼
decision = { intent: 'multi_intent', shortCircuited: true }
pendingIntents = ['search_hotels', 'explore_transport']
        │
        ▼
Session state updated:
  currentIntent = 'multi_intent'
  collectedFields.pendingIntents = ['search_hotels', 'explore_transport']
        │
        ▼
Twilio sends reply
User replies "1" → Flow 3a (Hotels)
User replies "2" → Flow 3b (Transport sub-menu)
```

**LLM calls: 0 | Latency: ~10ms**

---

## Flow 6 — Cached Informational Question (0 LLM calls)

**Triggers:** A question that was asked before (within 10 minutes) by any user

**Example:** Second user asks `"best beach near Colombo"`

```
userText = "best beach near Colombo"
        │
        ▼
No short-circuit, no menu selection, no multi-intent
        │
        ▼
LLMService.buildCacheKey(contextPackage)
  Normalises text:
    lowercase → "best beach near colombo"
    strip fillers (what, is, the, a, an, are...) → "best beach near colombo"
    strip punctuation → "best beach near colombo"
    base64 encode first 40 chars → cache key
        │
        ▼
StateStore.getClient().get(cacheKey)  → Redis
  Cache HIT: returns { decision, replyText } from 10 min ago
        │
        ▼
fromCache = true
replyText = (previously generated reply)
        │
        ▼
Session state updated with cached decision
        │
        ▼
Twilio sends reply
```

**LLM calls: 0 | Latency: ~15ms (Redis lookup only)**

---

## Flow 7 — General Question / LLM Reply (1 LLM call)

**Triggers:** Any substantive question not matched by flows 1–6

**Example:** `"What's the best time to visit Sigiriya?"`

```
userText = "What's the best time to visit Sigiriya?"
        │
        ▼
No short-circuit, no menu selection, no multi-intent, no cache hit
        │
        ▼
LLMService.trimHistory(contextPackage)
  Keeps last 3 turns (6 messages) from conversationHistory
        │
        ▼
LLMService.buildCombinedPrompt(trimmedContext)
  Builds single prompt asking LLM to return BOTH:
  - Structured decision (intent, parameters, missingFields, suggestedAction, confidence)
  - User-facing reply text
  Includes: conversation history, session state, user profile
        │
        ▼
POST https://api.groq.com/openai/v1/chat/completions
  System: CONCIERGE_SYSTEM_PROMPT + "respond with JSON only"
  User: combined prompt
  Model: llama-3.1-8b-instant
  Temperature: 0.2
  Max tokens: 512
        │
        ▼
LLMService.parseCombinedOutput(response)
  Strips markdown code fences if present
  Parses JSON: { intent, parameters, missingFields, suggestedAction, confidence, reply }
        │
        ▼
decision = { intent: 'explore_places', suggestedAction: 'clarify', confidence: 0.9 }
replyText = "The best time to visit Sigiriya is from January to April..."
        │
        ▼
isCacheable(decision)?
  intent not in ['book_hotel','make_payment','cancel_booking','handoff','clarify']
  suggestedAction !== 'execute_tool'
  → YES, cache it
        │
        ▼
StateStore.getClient().setEx(cacheKey, 600, JSON.stringify({decision, replyText}))
        │
        ▼
Session state updated:
  currentIntent = 'explore_places'
  collectedFields merged with decision.parameters
        │
        ▼
Twilio sends reply
        │
        ▼
Bot reply persisted to session_state.conversation_history
```

**LLM calls: 1 | Latency: ~500–800ms (Groq)**

---

## Flow 8 — Contextual Follow-up (1 LLM call, with history)

**Triggers:** Any message after a conversation has started (historyLength > 0)

**Example:** User previously asked about Sigiriya, now asks `"How do I get there from Colombo?"`

```
userText = "How do I get there from Colombo?"
conversationHistory = [
  { role: 'user',      content: "What's the best time to visit Sigiriya?" },
  { role: 'assistant', content: "The best time to visit Sigiriya is..." },
]
        │
        ▼
No short-circuit, no menu selection, no multi-intent
        │
        ▼
Cache key built from "how get there colombo" → likely a miss (first time)
        │
        ▼
LLMService.trimHistory() → keeps last 3 turns (2 here, both included)
        │
        ▼
buildCombinedPrompt includes:
  User message: "How do I get there from Colombo?"
  Recent conversation:
    user: "What's the best time to visit Sigiriya?"
    assistant: "The best time to visit Sigiriya is..."
  Session state: currentIntent = 'explore_places'
        │
        ▼
Groq API call
  LLM understands "there" = Sigiriya from context
  Returns: { intent: 'explore_transport', reply: "From Colombo, you can..." }
        │
        ▼
Contextual reply sent to user
```

**LLM calls: 1 | Latency: ~500–800ms**

---

## Flow 9 — Database Unavailable (degraded mode)

**Triggers:** PostgreSQL is down or credentials are wrong

```
userText = "Hi"
        │
        ▼
SessionManager.resumeSession() throws
  Error: "password authentication failed" or "ECONNREFUSED"
        │
        ▼
Caught by try/catch in processAndReply()
  sessionId = null
  contextPackage = null
  Logs: [WARN] Database unavailable — proceeding without session context
        │
        ▼
conversationHistory = []  (no DB to load from)
Inbound message NOT persisted (no sessionId)
        │
        ▼
decideAndReply() called with:
  userMessage: "Hi"
  conversationHistory: undefined
  userProfile: undefined
  sessionState: undefined
        │
        ▼
Short-circuit matches "Hi" → main menu returned
        │
        ▼
Session state update skipped (sessionId is null)
        │
        ▼
Twilio sends reply  ← Bot still replies!
        │
        ▼
Bot reply NOT persisted (no sessionId)
```

**Result:** User gets a reply but no memory is stored. Each message is treated as fresh.

---

## Flow 10 — Duplicate Message (Twilio retry)

**Triggers:** Twilio retries a webhook delivery (network timeout, slow response)

```
POST /webhook/whatsapp
  MessageSid = "SM93419bef95cb47be1146669fa896fcbd"  ← same as before
        │
        ▼
deduplicateWebhook middleware
  Redis GET "webhook:message:SM93419bef95cb47be1146669fa896fcbd"
  → EXISTS (set 2 minutes ago)
        │
        ▼
res.status(200).send('')  ← Twilio satisfied
return  ← processing SKIPPED entirely
```

**Result:** No duplicate reply sent to user. No DB writes. No LLM calls.

---

## Flow 11 — Rate Limited

**Triggers:** Same phone number sends more than 30 messages in 60 seconds

```
POST /webhook/whatsapp
  From = "whatsapp:+94770677470"
        │
        ▼
webhookRateLimiter
  Counter for +94770677470 = 31 (exceeds limit)
        │
        ▼
res.status(429).json({ error: 'Too many requests' })
  ← Twilio will retry later with exponential backoff
```

---

## Flow 12 — Invalid Twilio Signature (Production Only)

**Triggers:** Request not from Twilio (in production mode)

```
POST /webhook/whatsapp
  X-Twilio-Signature: "invalid_or_missing"
        │
        ▼
validateTwilioSignature middleware
  NODE_ENV = 'production'
  HMAC-SHA1 check fails
        │
        ▼
res.status(403).json({ error: 'Invalid signature' })
  ← Message dropped, not processed
```

In development (`NODE_ENV=development`), this check is skipped with a WARN log.

---

## Flow 13 — Media / Audio Message

**Triggers:** User sends an image, video, or voice note

```
POST /webhook/whatsapp
  NumMedia = "1"
  MediaUrl0 = "https://api.twilio.com/..."
  MediaContentType0 = "image/jpeg"
        │
        ▼
normalizeInboundMessage(payload)
  numMedia = 1, MediaUrl0 present
  mediaType = 'image' (from MIME type)
  content = { type: 'media', mediaType: 'image', mediaUrl: '...', caption: undefined }
        │
        ▼
userText = "[media message]"  ← extracted in processAndReply()
        │
        ▼
No short-circuit, no menu selection, no multi-intent
        │
        ▼
LLM call with userMessage = "[media message]"
  LLM likely returns intent = 'unknown' or 'clarify'
  reply = "I received your image! Unfortunately I can only process text right now..."
        │
        ▼
Twilio sends reply
```

---

## Decision Tree Summary

```
Inbound message
      │
      ├─ Rate limited?              → 429, stop
      ├─ Invalid signature (prod)?  → 403, stop
      ├─ Duplicate MessageSid?      → 200, stop
      │
      └─ Proceed to processAndReply()
            │
            ├─ DB available?
            │    ├─ YES → load/create session, load history
            │    └─ NO  → sessionId=null, continue without memory
            │
            └─ decideAndReply()
                  │
                  ├─ Menu selection (number/name/emoji)?  → 0 LLM, instant reply
                  ├─ Short-circuit pattern?               → 0 LLM, instant reply
                  ├─ Multi-intent keywords (2+)?          → 0 LLM, numbered list
                  ├─ Redis cache hit?                     → 0 LLM, cached reply
                  └─ None of the above                    → 1 LLM call (Groq)
                        │
                        └─ Combined intent + reply in single API call
                              │
                              └─ Cache result if informational intent
```

---

## Latency Reference

| Flow | Scenario | Approx. Latency |
|---|---|---|
| 1 | Greeting → main menu | ~5ms |
| 2 | Thanks / Yes / No / Bye | ~5ms |
| 3 | Menu number selection | ~10ms |
| 4 | Sub-menu selection | ~10ms |
| 5 | Multi-intent detection | ~10ms |
| 6 | Cached question | ~15ms |
| 7 | New question (LLM) | ~500–800ms |
| 8 | Follow-up with history (LLM) | ~600–900ms |
| 9 | DB unavailable (degraded) | ~5–800ms |
| 10 | Duplicate message | ~5ms |
| 11 | Rate limited | ~1ms |
| 12 | Invalid signature | ~1ms |

---

## Data Written Per Flow

| Flow | `users` | `sessions` | `session_state` | `messages` | Redis |
|---|---|---|---|---|---|
| First message ever | ✅ created | ✅ created | ✅ created | ✅ user msg | ✅ session state |
| Returning user | — | — | ✅ updated | ✅ user msg + bot reply | ✅ session state |
| DB unavailable | — | — | — | — | — |
| Duplicate | — | — | — | — | — |
| Rate limited | — | — | — | — | — |
| Cached reply | — | — | ✅ updated | ✅ user msg + bot reply | — (cache read only) |
| LLM reply | — | — | ✅ updated | ✅ user msg + bot reply | ✅ cache written |
