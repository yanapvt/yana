# LLMService

Handles all LLM interactions for the YANA concierge. Optimised to minimise API calls while maintaining quality.

---

## How It Works

Every inbound message goes through `decideAndReply()` which tries to avoid an LLM call entirely before falling back to one:

```
decideAndReply(contextPackage, activeSubMenu?)
  │
  ├─ 1. Menu selection?     → 0 LLM calls  (user replied "1"–"6")
  ├─ 2. Short-circuit?      → 0 LLM calls  (Hi, Thanks, Yes, No, Bye, Help)
  ├─ 3. Multi-intent?       → 0 LLM calls  ("hotels and transport in Galle")
  ├─ 4. Redis cache hit?    → 0 LLM calls  (same question, 10 min TTL)
  └─ 5. Single LLM call     → 1 API call   (intent + reply in one response)
```

Previously the code made 2 LLM calls per message (`decide()` then `generateUIContent()`). Now it's at most 1.

---

## Primary API

### `decideAndReply(contextPackage, activeSubMenu?)`

The main entry point. Returns a `DecisionWithReply` containing:

- `decision` — structured intent/parameters/missingFields/suggestedAction/confidence
- `replyText` — the actual text to send to the user
- `fromCache` — true if served from Redis cache
- `shortCircuited` — true if handled without LLM
- `activeSubMenu` — set when a menu category with sub-items was selected
- `pendingIntents` — set when multiple intents were detected

```typescript
const { decision, replyText, fromCache, shortCircuited, activeSubMenu, pendingIntents } =
  await llmService.decideAndReply(
    {
      userMessage: 'Best beach near Colombo?',
      conversationHistory: [...],
      userProfile: { preferredLanguage: 'en' },
      sessionState: { currentIntent: 'explore_places' },
    },
    activeSubMenuFromSession  // e.g. 'transport' if user previously selected transport
  );
```

### `decide(contextPackage)` — legacy

Delegates to `decideAndReply()` and returns only the decision. Kept for compatibility.

### `generateUIContent(prompt, userLanguage)` — standalone reply generation

Used when you need to generate a reply independently of intent detection (e.g. formatting tool results). Makes one LLM call.

```typescript
const text = await llmService.generateUIContent(
  'Format these hotel results for WhatsApp: [...]',
  'en'
);
```

---

## Short-Circuit Rules

These patterns are matched before any LLM call:

| Pattern | Intent | Reply |
|---|---|---|
| Hi, Hello, Hey, Good morning/evening, Start, Menu | `greeting` | Main menu |
| Thanks, Thank you, Great, Awesome | `acknowledgement` | "You're welcome! 😊" |
| Yes, Yeah, Ok, Sure, Alright | `confirmation` | "Got it!" |
| No, Nope, Cancel, Stop | `cancellation` | "No problem!" |
| Bye, Goodbye, Take care | `farewell` | Farewell message |
| Help, ?, What can you do, Menu, Options | `help` | Main menu |

---

## Menu System

The `MenuService` handles the interactive menu. `decideAndReply()` calls it automatically.

**Main menu categories:**
1. 🏖 Places to Visit → sub-menu: Beaches, Temples, Nature, Cities
2. 🍛 Food & Restaurants → sub-menu: Local Cuisine, Street Food, Seafood, Vegetarian
3. 🚌 Transport → sub-menu: Tuk-tuk, Taxi, Train, Car Hire
4. 🏨 Hotels & Stays
5. 🎭 Culture & Tips → sub-menu: Customs, Festivals, Practical Tips
6. 🆘 Emergency & Help

When a user selects a category with sub-items, the `activeSubMenu` is returned and should be stored in the session's `collectedFields`. On the next message, pass it back to `decideAndReply()` so numbered replies resolve against the sub-menu.

**Multi-intent detection** — if the user's message contains keywords for 2+ categories (e.g. "hotels and transport"), a numbered list of detected intents is returned without an LLM call.

---

## Response Cache

Informational replies are cached in Redis for 10 minutes using a normalised key derived from the user's message (filler words stripped, lowercased).

**Cached:** `explore_places`, `explore_food`, `explore_transport`, `explore_culture`, and similar informational intents.

**Never cached:** `book_hotel`, `make_payment`, `cancel_booking`, `handoff`, `clarify`, or any `execute_tool` action.

---

## System Prompt (Persona)

The `CONCIERGE_SYSTEM_PROMPT` constant is injected into every LLM call as the `system` message:

- **Identity:** Yana, friendly Sri Lanka tourist concierge
- **Topics:** Places, food, transport, culture, practical tips
- **Tone:** Warm, conversational, like a knowledgeable local friend
- **Format:** 2–4 sentences max, WhatsApp-friendly
- **Constraint:** Do not make up prices, schedules, or contact details

---

## Configuration

```env
LLM_PROVIDER=groq          # or 'openai'
LLM_API_KEY=gsk_xxx        # Groq or OpenAI API key
LLM_MODEL=llama-3.1-8b-instant
LLM_CONFIDENCE_THRESHOLD=0.85
```

Supported providers: `groq`, `openai` (both use the OpenAI-compatible API format).

---

## Error Handling

All errors throw `LLMServiceError` with:
- `message` — human-readable description
- `code` — machine-readable code (`MISSING_API_KEY`, `API_ERROR`, `PARSE_ERROR`, `EMPTY_RESPONSE`)
- `retryable` — whether the caller should retry

The webhook catches these and logs them without crashing.

---

## History Trimming

Only the last 3 turns (6 messages: 3 user + 3 assistant) are sent to the LLM. This keeps prompts lean while providing enough context for continuity. The full history is stored in Postgres.
