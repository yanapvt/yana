# YANA repository guidance

## Product

YANA is a WhatsApp-first travel concierge. The current runtime supports Twilio,
OpenWA, and Meta WhatsApp entry/outbound paths, profile-first collection forms,
hotel/restaurant/excursion/logistics search flows, itinerary planning, voice-note
transcription, optional voice replies, and provider-specific result rendering.

Read `docs/PROJECT_HANDOFF.md` before making architectural changes. Treat code
and passing tests as the source of truth; historical `TASK_*_COMPLETION.md` files
and external conversation notes may describe plans that were never implemented.

## Development baseline

- Install dependencies: `npm.cmd install`
- Build: `npm.cmd run build`
- Full tests: `npm.cmd test`
- Focused tests: `npm.cmd exec -- vitest --run <test files>`
- Validate migrations: `npm.cmd run db:validate`
- Development server: `npm.cmd run dev`

Run the build and focused tests for the affected flow before handing off. Run
the full test suite for cross-cutting changes to routing, state, storage,
configuration, providers, or WhatsApp delivery.

## Architecture rules

- Keep AI interpretation separate from deterministic execution. LLM output may
  classify intent or extract criteria, but it must not directly book, charge, or
  claim live availability.
- Keep provider-specific request/response shapes inside provider adapters.
- Normalize provider results before flow, session, or renderer code consumes them.
- Live inventory providers are authoritative for room availability and exact
  prices. Google Places is discovery/enrichment and must not be represented as
  confirmed inventory.
- Provider enablement must be explicit and independently configurable. One
  provider failure should degrade to another configured provider when safe.
- Recheck a selected rate before booking or payment.
- Preserve the existing profile gate, form flows, background-search behavior,
  voice mode, pagination, and provider-specific WhatsApp rendering.
- Do not merge the old `origin/feature/whatsapp-session-memory` branch wholesale.
  Port small concepts with current-flow tests because it diverged before the
  current OpenWA/Meta/forms/itinerary work.

## State and data

- Redis is used for active state with in-memory fallback in supported paths.
- Postgres repositories provide durable profile and service-request/session data.
- Search results are shown in batches of three, with up to three batches.
- Never expose internal rate tokens, booking tokens, API credentials, or raw
  provider errors in user-facing messages.

## Configuration and secrets

- Document variable names and safe defaults in `.env.example`.
- Never commit `.env`, API keys, tokens, credentials, customer data, or copied
  production logs.
- Production validation must require credentials only for the selected provider.
- Feature flags should have deterministic defaults and tests for enabled,
  disabled, failure, and fallback behavior.

## Working tree

- Preserve unrelated user changes and untracked artifacts such as `output/`.
- Use `rg`/`rg --files` for discovery and `apply_patch` for manual edits.
- Do not reset, discard, or rewrite user work.

## External knowledge base

The read-only Obsidian YANA hub is at
`C:\Users\digitize\Documents\Codex\knowledge-base\04 Projects\Yana\Yana.md`.
Use only YANA-rooted notes and direct relevant links/backlinks. Do not ingest
unrelated personal or project notes. Reconcile all extracted claims against the
current repository before treating them as implemented.
