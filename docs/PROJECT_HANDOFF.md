# YANA project handoff

Last reconciled: 2026-08-24
Verified commit: `e6183e6`
Development branch: `codex/yana-next-development-20260824`

## Repository baseline

The working OpenWA/voice/Meta branch was promoted to `main` and backed up before
new development began.

- Stable baseline: `main` at `e6183e6`
- Recoverable backup: `codex/backup-working-baseline-20260824`
- Active branch: `codex/yana-next-development-20260824`
- Historical comparison branch: `origin/feature/whatsapp-session-memory`

Do not reset to an older historical `main` or merge the comparison branch in
bulk. Its provider/session work is useful reference material, but it conflicts
with newer webhook, forms, state, database, LLM, and WhatsApp-provider changes.

## Verified on 2026-08-24

- `npm.cmd run build` passes.
- 98 focused tests pass across:
  - `HotelSearchFlowService`
  - `GooglePlacesHotelBrowsingService`
  - the multi-vertical webhook/form/voice flow
  - `MetaWhatsAppOutboundService`
  - orchestration
- Redis was not running during this focused test run. Expected connection
  warnings were emitted and the in-memory state fallback was exercised.

This verification did not claim that live provider credentials, live WhatsApp
accounts, Postgres/Redis infrastructure, or deployment targets were healthy.

## Implemented product surface

- Express application with health, webhook, form, media, itinerary workspace,
  legal, and demo routes.
- WhatsApp provider selection for Twilio, OpenWA, and Meta.
- Profile-first service collection.
- Secure collection forms for hotel, restaurant, excursion, logistics, and
  itinerary requests.
- Multi-turn hotel intake with deterministic extraction and optional LLM-assisted
  extraction.
- Google Places discovery for hotels, restaurants, and excursions.
- Placeholder/deterministic transport provider behavior.
- Local rule-based ranking and three-at-a-time pagination.
- Redis-backed active sessions with supported in-memory fallback and Postgres
  repositories for durable flow data.
- Background search acknowledgements and result replay/status behavior.
- Voice-note transcription and optional outbound voice responses.
- Meta carousel result cards, including transport, and smart place detail views.
- Itinerary generation, navigation, and incremental edits.

## Important limitations

- Google Places does not provide confirmed rooms, bookable rates, taxes, or live
  availability.
- The Nango hotel path is not a production-ready live inventory integration;
  its base HTTP execution remains placeholder-level.
- Hotel selection currently reaches a booking-provider boundary rather than a
  complete rate-recheck and booking transaction.
- Payment, confirmed booking, cancellation, refund, supplier reconciliation,
  and audit workflows are not established as production-complete.
- Existing historical status/completion documents predate newer development and
  may overstate or understate the current product.

## External context used

The Obsidian YANA hub and its direct technical links were used read-only. Durable
decisions were extracted into `docs/DECISIONS.md`; external notes remain context,
not implementation proof.

## Immediate development direction

The supplier-neutral hotel/rate contracts, acquisition-cost calculation, pricing
engine, comparability rules, supplier adapter interface, decision engine, and
parallel supplier orchestrator are now implemented under
`src/services/hotel-engine/`. Typed environment loading is implemented in
`src/config/hotelSuppliers.ts`; all suppliers are disabled by default.

A real LiteAPI search-only adapter and credential-safe local smoke command are
implemented. The adapter follows `X-API-Key` authentication and the documented
`POST /v3.0/hotels/rates` contract. It normalizes hotels, mapped rooms, offers,
meal plans, cancellation conditions, taxes, and returned prices. It does not yet
prebook or book, and it refuses to price retail-only results as net acquisition
cost. See `docs/LITEAPI_LOCAL_TEST.md`.

Next:

1. Run the LiteAPI smoke test with a sandbox/live key and capture only sanitized
   field-shape observations.
2. Confirm whether the account returns net or retail pricing and obtain written
   markup/display/booking permissions.
3. Connect verified inventory results to the current hotel flow behind the global
   and supplier flags.
4. Merge Google discovery enrichment with authoritative inventory results.
5. Persist provider, property, room, offer, and rate identifiers in sessions.
6. Implement LiteAPI prebook/recheck before any booking/payment work.

See `docs/HOTEL_MULTI_PROVIDER_DESIGN.md` for the implementation boundary.
