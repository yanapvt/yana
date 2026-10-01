# SLTDA registered accommodation integration

YANA treats the existing local `srilanka_accommodations` table as a registration and
licence-verification source. It is not a room availability or pricing source.
Only data obtained with appropriate permission should be imported.

## Exploration sequence

1. Collect customer destination, dates, occupancy, budget and preferences.
2. Search Google Places discovery results without calling live inventory suppliers.
3. Deterministically match Google candidates to eligible local SLTDA records.
4. When strict verification is enabled, remove unmatched Google candidates.
5. Rank and show verified discovery cards in batches of three.
6. Treat Google price levels as exploration signals, not confirmed room rates.

## Booking-check sequence

1. The customer selects a displayed hotel with `book N`.
2. Query eligible local SLTDA records for the selected destination.
3. Stop when strict verification is enabled and no eligible record or deterministic
   selected-hotel match exists.
4. Search enabled live inventory suppliers for the requested dates and occupancy.
5. Match supplier hotels to the selected Google result and an eligible SLTDA record.
6. Exclude unverified, unavailable, unbookable and over-budget rates.
7. Return customer-safe live room/rate options and retain structured internal logs.
8. Recheck the selected rate again before any future booking/payment transaction.

## Configuration

```env
SLTDA_REGISTRY_ENABLED=true
SLTDA_REQUIRE_VERIFIED_HOTELS=true
SLTDA_MATCH_MIN_CONFIDENCE=0.80
HOTEL_SUPPLIER_REJECTION_AUDIT_ENABLED=true
ADMIN_CONTROL_TOKEN=<long-random-secret>
```

Keep the feature disabled until migration `015_support_srilanka_accommodations.sql`
has run and authorized records are present. The migration preserves an existing
table and its rows, creating only missing compatibility indexes. On a fresh
database it creates the import table with the established scraper schema.

## Runtime exploration controls

After migration `017_create_hotel_search_settings.sql` is applied, an authenticated
operator can open `/admin/hotel-search`. The browser uses HTTP Basic authentication;
enter any username and use `ADMIN_CONTROL_TOKEN` as the password.

The page controls strict SLTDA exploration filtering, minimum Google rating, and
minimum Google review count. The zero-result filter safeguard is always enabled.
Settings are stored in
Postgres and take effect on the next search without restarting PM2. If no database
row exists, the SLTDA default comes from `SLTDA_REQUIRE_VERIFIED_HOTELS` and the
zero-result fallback defaults to enabled.

Keep the admin route behind HTTPS. When `ADMIN_CONTROL_TOKEN` is empty, the route
returns 404. The fallback can only restore hotels actually returned by Google; it
cannot manufacture results if Google itself returns none or fails.

## Required import fields

Every record requires `name`; `record_key` should be stable and unique. Reliable
production matching should also populate address or local authority, registration
number, licence number, licence validity, website and telephone whenever
the licensed source provides them.

A row must have at least `registration_no` or `licence_no` to be treated as
verified. A parseable expired licence date is rejected.

Expired, cancelled or suspended records are not eligible. A probable or
ambiguous name match is not shown as verified.

## Logs

The flow emits `registry_lookup_completed`, `hotel_match_verified`,
`live_supplier_gate_stopped`, `supplier_search_succeeded`,
`supplier_rate_attributed`, `supplier_hotel_ignored_unregistered`,
`verified_inventory_gate_stopped`, and `verified_inventory_merge_completed`
events. With supplier attribution logging enabled, rejected supplier hotels and
their returned amount summaries are written to internal logs. Logs exclude API
credentials and raw supplier offer/rate/search tokens.

When rejection auditing is enabled, the same sanitized rejection data is stored
in `rejected_hotel_inventory_audit`, one row per rejected supplier rate (or one
hotel-only row when no rates were returned). Audit persistence is best-effort and
cannot make a customer search fail.
