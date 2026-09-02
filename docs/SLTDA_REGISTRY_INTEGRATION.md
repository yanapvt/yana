# SLTDA registered accommodation integration

YANA treats the existing local `srilanka_accommodations` table as a registration and
licence-verification source. It is not a room availability or pricing source.
Only data obtained with appropriate permission should be imported.

## Search sequence

1. Collect customer destination, dates, occupancy, budget and preferences.
2. Search Google Places when configured for candidate enrichment.
3. Query eligible local SLTDA records for the requested location.
4. When verification is required and no eligible record exists, stop before
   calling a live inventory supplier.
5. Search enabled live inventory suppliers.
6. Deterministically match supplier hotels to local registry records and Google
   candidates.
7. Exclude unverified hotels when the verification gate is enabled.
8. Exclude same-currency rates above the total budget for the stay and rooms.
9. Rank verified results by returned total and Google rating.
10. Send customer-safe WhatsApp cards and retain structured internal logs.

## Configuration

```env
SLTDA_REGISTRY_ENABLED=true
SLTDA_REQUIRE_VERIFIED_HOTELS=true
SLTDA_MATCH_MIN_CONFIDENCE=0.80
```

Keep the feature disabled until migration `015_support_srilanka_accommodations.sql`
has run and authorized records are present. The migration preserves an existing
table and its rows, creating only missing compatibility indexes. On a fresh
database it creates the import table with the established scraper schema.

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
`supplier_rate_attributed`, and `verified_inventory_merge_completed` events.
Logs exclude API credentials and raw supplier offer/rate tokens.
