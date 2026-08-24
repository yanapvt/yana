# Durable decisions

Last reconciled: 2026-08-24

## Confirmed decisions

1. **Keep AI and transactions separate.** AI interprets natural language; code
   and provider responses control availability, pricing, booking, and payment.
2. **Keep Google Places.** It is valuable for discovery, ratings, reviews,
   addresses, photos, and maps.
3. **Do not call Google results available rooms.** They are recommendations until
   an inventory provider confirms a rate for the requested dates and occupancy.
4. **Support multiple providers.** Discovery, enrichment, inventory, and booking
   may come from different providers behind normalized contracts.
5. **Allow independent provider enablement.** A provider can be enabled, disabled,
   unavailable, or failing without requiring code edits or taking down every
   search path.
6. **Inventory wins for commercial data.** Exact price, taxes, cancellation,
   room availability, rate ID, and booking terms come from the inventory provider.
7. **Recheck before booking.** Availability and price must be reconfirmed after
   user selection and before charging or confirming.
8. **Preserve graceful fallback.** Inventory-only results can work without Google
   enrichment. Google-only results can be shown with an explicit availability
   disclaimer. Provider errors must not be presented as successful searches.
9. **Use the current branch architecture.** The old session-memory branch is a
   design reference, not a merge target.
10. **Treat supplier access as contractual.** Booking.com/Agoda affiliate access
    is not equivalent to Demand/B2B inventory and direct booking permission.

## Supplier direction from the knowledge base

- LiteAPI/Nuitee was identified as a possible first live inventory supplier.
- Booking.com Demand API may support integrated flows only with the appropriate
  managed partner access and permissions.
- Agoda Demand/B2B capabilities and commercial terms require direct confirmation.
- The product should retain the ability to add Hotelbeds, WebBeds, direct hotel
  connections, or other suppliers later.
- A supplier must not be advertised as live until credentials, inventory scope,
  checkout model, payment liability, cancellation operations, and commercial
  rights are verified.

## Open decisions

- Identity/matching strategy across discovery and inventory suppliers.
- First production inventory provider and exact API contract.
- Supplier of record and merchant-of-record responsibilities.
- Markup versus commission model, currency/FX handling, and tax presentation.
- Booking, cancellation, modification, refund, and reconciliation ownership.
- Whether simultaneous inventory calls or ordered fallback is commercially and
  operationally preferable for the first release.
