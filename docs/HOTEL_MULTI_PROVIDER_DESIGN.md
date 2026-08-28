# Hotel multi-provider integration design

## Implementation status

Foundation implemented on 2026-08-24 under `src/services/hotel-engine/`:

- canonical supplier-neutral hotel, room, rate, money, occupancy, cancellation,
  payment, reference-price, and commercial-capability types
- common `HotelSupplierAdapter` lifecycle contract
- strict comparable-rate grouping
- auditable true acquisition-cost calculation
- configurable markup-versus-margin pricing
- maximum-margin, competitive, best-price, and direct-priority strategy contracts
- rejection of expired, unavailable, non-bookable, or commercially restricted rates
- supplier-neutral best-offer selection within equivalent-rate groups
- parallel supplier orchestration with per-supplier timeout and abort signaling
- configurable retries, rate limits, circuit breakers, priority, and health state
- partial-failure aggregation so one failed supplier does not suppress good results
- typed environment configuration for LiteAPI, Hotelbeds, WebBeds, Booking.com
  Demand, Agoda, and YANA Direct
- LiteAPI search-only adapter and a sanitized local smoke-test command

This foundation is not connected to the live webhook yet. Existing Google Places
search behavior remains unchanged while supplier adapters and orchestration are
implemented and tested incrementally.

The LiteAPI adapter is intentionally search-only until the live/sandbox response
shape and commercial price basis are verified. Retail prices are not treated as
net acquisition cost, and prebook/book methods fail closed.

## Goal

Add one or more live hotel/room APIs while retaining Google Places discovery and
allowing every provider to be enabled or disabled independently.

## Proposed flow

```text
HotelSearchCriteria
  -> HotelProviderRouter
       -> discovery providers (Google Places)
       -> inventory providers (new API, later suppliers)
  -> normalize each response
  -> reconcile property identities
  -> merge enrichment with authoritative room/rate data
  -> rank available properties first
  -> persist result and rate identifiers
  -> render first three choices
```

## Contracts

```ts
type HotelProviderCapability = 'discovery' | 'inventory' | 'booking';

interface HotelProperty {
  canonicalId: string;
  name: string;
  address?: string;
  coordinates?: { latitude: number; longitude: number };
  rating?: number;
  reviewCount?: number;
  amenities: string[];
  images: Array<{ url: string; source: string }>;
  googlePlaceId?: string;
  googleMapsUri?: string;
  providerReferences: Array<{ provider: string; propertyId: string }>;
  rooms: HotelRoomOffer[];
  sources: string[];
}

interface HotelRoomOffer {
  provider: string;
  propertyId: string;
  roomId: string;
  rateId: string;
  roomName: string;
  availableCount?: number;
  mealPlan?: string;
  occupancy?: { adults: number; children: number };
  nightlyPrice?: Money;
  taxes?: Money;
  totalPrice: Money;
  refundable: boolean;
  freeCancellationUntil?: string;
  expiresAt?: string;
}

interface Money {
  amount: number;
  currency: string;
}
```

The implemented domain contracts follow this design and live under
`src/services/hotel-engine/types.ts`. The final adapter mapping must still reflect
each supplied API's actual contract.

## Configuration

Core variables:

```env
HOTEL_GOOGLE_PLACES_ENABLED=true
GOOGLE_PLACES_API_KEY=

HOTEL_SUPPLIER_ORCHESTRATION_ENABLED=false
HOTEL_SUPPLIER_TIMEOUT_MS=15000
HOTEL_SUPPLIER_MAX_RETRIES=2
HOTEL_SUPPLIER_RETRY_DELAY_MS=500
HOTEL_SUPPLIER_CIRCUIT_FAILURE_THRESHOLD=3
HOTEL_SUPPLIER_CIRCUIT_COOLDOWN_MS=60000
HOTEL_SUPPLIER_RATE_LIMIT_PER_MINUTE=60

LITEAPI_ENABLED=false
LITEAPI_BASE_URL=https://api.liteapi.travel/v3.0
LITEAPI_API_KEY=
```

The repository now uses provider-specific prefixes rather than the generic
`HOTEL_INVENTORY_API_*` placeholders. See `.env.example` for the complete list.
Global `HOTEL_SUPPLIER_*` policies can be overridden with provider-prefixed
values such as `LITEAPI_TIMEOUT_MS`. Secrets belong in `.env`/deployment secret
storage, never `.env.example` values.

Both levels must be enabled before a supplier executes:

```text
HOTEL_SUPPLIER_ORCHESTRATION_ENABLED=true
LITEAPI_ENABLED=true
```

When orchestration is disabled, configured supplier flags and keys remain inert.
Internal rate-source logging can be enabled with
`HOTEL_SUPPLIER_ATTRIBUTION_LOG_ENABLED=true`. It emits structured
`supplier_rate_attributed` server events containing the supplier, correlation
ID, YANA hotel/room IDs, supplier hotel ID, room name, and a one-way fingerprint
of the supplier offer ID. Raw offer/rate tokens are deliberately excluded, and
these fields must never be copied into customer-facing WhatsApp output.
When orchestration is enabled, every enabled supplier must have a valid base URL
and API key. Empty example entries never activate a provider.

## Execution behavior

| Discovery | Inventory | Behavior |
|---|---|---|
| enabled/success | enabled/success | Merge enrichment and live offers |
| enabled/success | disabled | Discovery results with availability disclaimer |
| disabled | enabled/success | Inventory properties and rooms without Google enrichment |
| enabled/failure | enabled/success | Continue with inventory and log discovery failure |
| enabled/success | enabled/failure | Continue with discovery and disclose availability is unconfirmed |
| disabled/failure | disabled/failure | Deterministic unavailable/retry response |

Inventory price and availability must never be overwritten with Google price
levels. Provider calls should have explicit timeouts and structured failure data.

## Property reconciliation

Prefer identifiers supplied by a mapping partner or the inventory provider. When
none exists, reconcile conservatively using normalized name plus location and,
when available, coordinate proximity. Ambiguous matches should remain separate;
incorrectly merging two properties is worse than showing a duplicate.

## Session changes required

The current hotel session stores `HotelBrowseResult`. Introduce a normalized
search result snapshot that retains:

- canonical property ID
- provider property references
- room/rate IDs
- displayed batch and display number
- search ID and expiry
- selected room/rate snapshot
- last successful rate-recheck state

Rate IDs and provider tokens should be server-side only.

## Booking boundary

```text
user selects hotel/room
  -> load saved provider and rate ID
  -> rate recheck
  -> compare availability/currency/total
  -> obtain user confirmation if price changed
  -> create booking or redirect through permitted supplier flow
  -> persist provider confirmation
  -> only then claim confirmed booking
```

## Implementation sequence

1. Obtain sanitized API documentation and request/response examples.
2. Add the first real supplier adapter and contract tests.
3. Register verified adapters with `HotelSupplierOrchestrator` using effective
   environment configs.
4. Wrap existing Google Places service as discovery enrichment.
5. Add conservative property reconciliation.
6. Generalize hotel session storage and rendering.
7. Add rate-recheck boundary.
8. Run focused and full test suites.

## Reference branch

`origin/feature/whatsapp-session-memory` contains a `ProviderRouter`, normalized
types, and a LiteAPI adapter that may inform implementation. It diverges from the
current codebase and predicts extensive merge conflicts, so copy no file without
reviewing it against the current webhook, storage, forms, and WhatsApp-provider
contracts.
