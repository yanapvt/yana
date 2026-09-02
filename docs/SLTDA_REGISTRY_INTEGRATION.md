# SLTDA registered accommodation integration

YANA treats the local `registered_accommodations` table as a registration and
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

Keep the feature disabled until migration `014_create_registered_accommodations.sql`
has run and authorized records have been imported.

## Required import fields

Every record requires `property_name` and `normalized_name`. Reliable production
matching should also populate address, district or local authority, registration
number, licence number, licence validity, website/domain and telephone whenever
the licensed source provides them.

Expired, cancelled or suspended records are not eligible. A probable or
ambiguous name match is not shown as verified.

## Logs

The flow emits `registry_lookup_completed`, `hotel_match_verified`,
`live_supplier_gate_stopped`, `supplier_search_succeeded`,
`supplier_rate_attributed`, and `verified_inventory_merge_completed` events.
Logs exclude API credentials and raw supplier offer/rate tokens.
