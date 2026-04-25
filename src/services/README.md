# Services

Overview of all services and their current status.

---

## Active (called from the message pipeline)

### `LLMService`
Handles all LLM interactions. Optimised to minimise API calls via short-circuit rules, menu resolution, multi-intent detection, and Redis caching. Makes at most 1 API call per message. See `LLMService.README.md`.

### `MenuService`
Manages the interactive numbered menu system. 6 main categories with sub-menus. Handles menu selection resolution and multi-intent keyword detection. No LLM calls.

### `SessionManager`
Session lifecycle management. Creates users and sessions on first contact, resumes on subsequent messages. Loads/saves conversation history. Persists messages to both the `messages` table and `session_state.conversation_history`. Has a `getSessionManager()` singleton factory.

### `StateStore`
Redis wrapper. Caches session state (TTL from `SESSION_TTL_SECONDS`), tool results (5 min TTL), and LLM response cache (10 min TTL, managed by LLMService). Has a `getStateStore()` singleton factory.

---

## Built, Not Yet Wired

These are complete implementations that are not yet called from `processAndReply()`:

### `Orchestrator`
Validates LLM decision outputs against schema and business rules. Enforces confidence thresholds. Returns `ValidatedDecision` with `shouldProceed` and `fallbackAction`. Has a `getOrchestrator()` singleton factory.

### `SchemaEngine`
Schema-driven field collection. Given a schema definition and collected fields, determines what's missing and generates prompts to collect them. Used for multi-step flows like hotel search.

### `MCPInterface`
Tool call routing layer. Validates tool calls against registered contracts, routes to provider adapters, handles retries with exponential backoff, logs all executions. Requires adapters to be registered via `registerAdapter()`.

### `ToolRegistry`
Stores tool definitions in the `tool_registry` table. Tools define their parameters, provider mapping, and execution policy. No tools are registered yet.

### `WhatsAppRenderer`
Formats content as WhatsApp-safe messages. Handles text, buttons (max 3), lists (max 10 items), confirmations, field prompts, and hotel results. Falls back to plain text when UI limits are exceeded.

### `TranslationService`
Language detection and translation. Currently configured with `TRANSLATION_PROVIDER=mock`.

### `LanguagePreferenceManager`
Detects and persists user language preferences.

---

## Adapters (`services/adapters/`)

### `HotelSearchAdapter`
Extends `NangoAdapter`. Searches hotels via a provider API and normalises results into `HotelResult[]`. The `performHttpRequest` method is a stub that throws — needs a real HTTP implementation.

### `NangoAdapter`
Base class for OAuth-based provider integrations. Handles token caching, retry logic, rate limit detection. `fetchTokenFromNango` throws — needs Nango credentials or a direct API key bypass.

### `ProviderAdapter` / `BaseProviderAdapter`
Interface and base class for direct (non-Nango) provider integrations.

---

## Singleton Pattern

All active services use the same singleton pattern:

```typescript
// Get existing instance (creates one if needed)
const service = getSessionManager();  // or getLLMService(), getStateStore(), etc.

// Initialize with custom config (replaces singleton)
const service = initLLMService({ provider: 'openai', apiKey: '...' });
```
