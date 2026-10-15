# YANA full-schema flow QA status — 2026-10-13

## Follow-up: hotel intake loop repair — 2026-10-14

The OpenWA transcript exposed a webhook continuity bug: the hotel intake
service retained its pending field, but the webhook only used its answer when
the latest message repeated a hotel keyword. Short replies such as “tomorrow,”
“2,” and “$50” therefore escaped into the general LLM route. The webhook now
honors an active intake reply; explicit switches to other services clear the
stale hotel intake. Invalid conversational text is no longer stored as a date,
bare dollar amounts are accepted when budget is requested, and a duration such
as “3 days” can derive check-out from check-in. A transcript-shaped regression
test covers those turns.

Follow-up verification: 121 focused tests passed; TypeScript build passed; the
full suite passed (102 files, 1,013 tests). The existing OpenWA server was not
sent a live message as part of this fix.

## Follow-up: restore hotel form gate — 2026-10-14

The next WhatsApp test showed incomplete hotel searches were reaching results
with stale intake values instead of presenting the structured hotel form. New
incomplete hotel requests now open that form; a one-message request can still
search directly only when all required criteria were extracted. Existing
form-pending sessions remind the traveler to complete the form if they reply in
chat instead. Starting a fresh hotel request clears any prior conversational
intake, and relative date words are excluded from the hotel location.

Verification for this follow-up: 121 focused tests passed; TypeScript build
passed; full suite passed (102 files, 1,015 tests). No live OpenWA message was
sent; the corrected behavior still needs the same manual sandbox re-test.

## Status

Local flow repairs are implemented and verified. This is not production or
live-provider sign-off: no real WhatsApp messages, supplier bookings, payments,
or external writes were made during this QA pass.

## What changed

- Restaurant and excursion exploration now accepts a location/destination
  without requiring booking-only dates, times, or party details first.
- Natural requests to explore hotels continue through the existing conversational
  hotel intake; explicit booking language continues to use the structured form.
- The profile-first gate now resumes a saved hotel request after the profile is
  completed, rather than losing the original request in a generic greeting.
- Switching from an active hotel search to a restaurant or excursion request
  clears the stale hotel session and starts the new discovery path.
- Restaurant/excursion result text and cards no longer say “Book now” when no
  reservation/experience supplier is connected. Restaurant selection directs
  the traveler to contact the venue; excursion copy states that provider
  availability and booking are not connected.
- The excursion booking request form collects a guest count and the mapper
  carries that count into the saved request.
- The logistics request schema now rejects a request without destination, date,
  and time (including the supported legacy aliases), matching the actual quote
  request requirements.
- Focused regression tests cover these discovery, switching, validation, and
  honesty boundaries.

## Flow matrix

| Service | Explore/discovery | User asks to proceed | What is actually connected | Remaining gap |
| --- | --- | --- | --- | --- |
| Hotel | Conversational intake collects location, dates, guests, and budget; browse suggestions can be returned. | Explicit booking uses the form; selecting a result runs a configured supplier recheck when available. It does not itself complete booking/payment. | Google Places discovery and the existing LiteAPI adapter/recheck scaffolding, subject to configuration and account access. | Enable/test the selected supplier in sandbox, verify rate semantics/markup permissions, add prebook and booking transaction, then payment and confirmation/reconciliation. Other named suppliers need separate adapters/contracts. |
| Restaurant | Google Places discovery by town/area, with details and map information. | Selection can show direct venue contact/map information; it does not create a reservation. | Google Places discovery only. | Connect a reservation source or venue workflow before offering YANA-managed reservations or quoting availability. |
| Excursion | Google Places discovery by destination with result details/cards. | Explicit booking gathers request details and guest count, then saves a pending request; it does not contact a supplier. | Google Places discovery and local request persistence. | Integrate and contract with Viator, GetYourGuide, DMC/GoodPass, or direct operators; add live availability, pricing, vendor handoff, confirmation, and cancellation handling. |
| Logistics | Request form captures pickup, destination, date/time, passengers, and preferences; current options are illustrative. | Selection prepares an operator quote request; no vehicle/driver is reserved. | Deterministic illustrative options and saved request state. | Connect an operator/DMC, implement quote/availability response and explicit confirmation before representing any trip as booked. |

## Recommended customer lifecycle

1. Treat a message as general chat until there is enough intent to identify a
   YANA service; ask a short conversational clarification if the intent is
   ambiguous.
2. In explore mode, collect only the minimum useful search context and show
   clearly labeled discovery suggestions.
3. Enter booking mode only when the customer explicitly selects/requests a
   transaction. Collect required booking details and check an authoritative
   provider where one is configured.
4. Do not say “available,” “reserved,” “booked,” or “confirmed” until the
   authoritative provider confirms it. If a provider is missing, say so and
   offer safe next steps (details, direct contact, or an explicitly consented
   concierge request).
5. For out-of-scope needs, first handle immediate safety concerns, explain
   kindly that YANA does not provide that service, and only offer nearby
   discovery when the traveler provides an approximate location. State that
   third-party services are independently selected and not guaranteed by YANA.

## Verification performed

- Focused flow tests: 120 passed across the webhook, forms, restaurant,
  excursion, excursion request mapping, and out-of-scope support tests.
- TypeScript build: `npm.cmd run build` passed.
- Full test suite: 102 files, 1,011 tests passed (`npm.cmd test -- --silent --reporter=dot`).
- No live WhatsApp smoke test or live supplier call was performed. These require
  the running local integrations and sandbox credentials and should be done
  separately before deployment.

## Decisions / later edits

- Keep Google Places strictly as discovery/enrichment, not confirmed inventory.
- Keep hotel, restaurant, excursion, and transport schemas service-specific;
  represent chat/explore/booking as journey state within the existing service
  flows rather than duplicating schemas.
- Do not claim an end-to-end transaction until the supplier, payment, refund,
  and operator-confirmation boundaries are implemented and tested.
- Before live use, review the customer-facing third-party disclaimer and
  out-of-scope liability wording with the business/legal owner.

## Next work

1. Run the manual OpenWA sandbox cases: hotel explore → dates → results →
   explicit booking check; restaurant explore → details/direct venue; excursion
   explore → details → request form; transport request → quote boundary; and a
   mid-flow switch between two services.
2. Report any exact WhatsApp message where the received response differs from
   these intended states, along with approximate timestamp and provider
   (OpenWA/Twilio/Meta). Do not paste credentials or personal customer details.
3. Choose and provide authorized sandbox access/terms for the next supplier
   integrations; do not enable providers with unknown pricing, resale, or
   commission permissions.
